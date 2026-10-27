import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { resolve, toNamespacedPath } from 'node:path'
import {
    downloadThumbnailPaths,
    type DownloadThumbnailRepository,
    type ThumbnailFileProof,
    type ThumbnailWork
} from '@features/thumbnail/DownloadThumbnailRepository'
import type { DownloadPreviewService } from '../thumbnail/DownloadPreviewService'
import { inspectThumbnailJpeg } from '@features/thumbnail/ThumbnailImageService'
import { inspectDownloadFile } from './DownloadVerificationService'
import { StorageDirectories, nodeStorageFileSystem } from './DownloadStorageService'

type Repository = Pick<
    DownloadThumbnailRepository,
    'pending' | 'claim' | 'recordPrepared' | 'complete' | 'fail' | 'defer'
>

interface ServiceOptions {
    inspectJpeg?: typeof inspectThumbnailJpeg
    onChanged?: (mediaId: number) => void
}

const MAX_BYTES = 8 * 1024 * 1024

function pathKey(value: string): string {
    const absolute = resolve(value)

    return process.platform === 'win32' ? toNamespacedPath(absolute).toLowerCase() : absolute
}

function stamp(info: BigIntStats): string {
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.nlink].join(':')
}

async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path)
        return true
    } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') {
            return false
        }

        throw error
    }
}

async function readBounded(path: string, links: 1n | 2n = 1n): Promise<Buffer> {
    const before = await lstat(path, { bigint: true })

    if (
        !before.isFile() ||
        before.nlink !== links ||
        before.size <= 0n ||
        before.size > BigInt(MAX_BYTES) ||
        pathKey(await realpath(path)) !== pathKey(path)
    ) {
        throw new Error('THUMBNAIL_FILE_INVALID')
    }

    const handle = await open(path, 'r')

    try {
        if (stamp(before) !== stamp(await handle.stat({ bigint: true }))) {
            throw new Error('THUMBNAIL_FILE_CHANGED')
        }

        const chunks: Buffer[] = []
        let total = 0

        for (;;) {
            const chunk = Buffer.alloc(64 * 1024)
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)

            if (bytesRead === 0) break

            total += bytesRead

            if (total > MAX_BYTES) {
                throw new Error('THUMBNAIL_FILE_TOO_LARGE')
            }

            chunks.push(chunk.subarray(0, bytesRead))
        }

        if (
            stamp(before) !== stamp(await handle.stat({ bigint: true })) ||
            stamp(before) !== stamp(await lstat(path, { bigint: true })) ||
            pathKey(await realpath(path)) !== pathKey(path)
        ) {
            throw new Error('THUMBNAIL_FILE_CHANGED')
        }

        return Buffer.concat(chunks)
    } finally {
        await handle.close()
    }
}

function assertArtifact(expected: ThumbnailFileProof, actual: ThumbnailFileProof): void {
    if (
        expected.sha256 !== actual.sha256 ||
        expected.size !== actual.size ||
        expected.device !== actual.device ||
        expected.inode !== actual.inode ||
        expected.mtimeNs !== actual.mtimeNs ||
        expected.width !== actual.width ||
        expected.height !== actual.height
    ) {
        throw new Error('THUMBNAIL_FILE_CHANGED')
    }
}

function assertCurrentFile(proof: ThumbnailFileProof, info: BigIntStats, links: 1n | 2n): void {
    if (
        !info.isFile() ||
        info.nlink !== links ||
        info.dev.toString() !== proof.device ||
        info.ino.toString() !== proof.inode ||
        info.size !== BigInt(proof.size) ||
        info.mtimeNs.toString() !== proof.mtimeNs ||
        info.ctimeNs.toString() !== proof.ctimeNs
    ) {
        throw new Error('THUMBNAIL_FILE_CHANGED')
    }
}

export class DownloadThumbnailService {
    private stopped = false
    private processing = false

    constructor(
        private readonly repository: Repository,
        private readonly previews: Pick<DownloadPreviewService, 'get'>,
        private readonly options: ServiceOptions = {}
    ) {}

    stop(): void {
        this.stopped = true
    }

    async runPending(): Promise<void> {
        if (this.processing || this.stopped) return

        this.processing = true

        try {
            for (const taskId of this.repository.pending()) {
                if (this.stopped) break
                try {
                    const work = this.repository.claim(taskId)
                    if (!work) continue

                    await this.process(work)

                    try {
                        this.options.onChanged?.(work.mediaId)
                    } catch {
                        // 알림 실패가 완료된 DB 등록을 바꾸지 않게 한다.
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : ''

                    if (message === 'THUMBNAIL_SOURCE_BUSY') {
                        this.repository.defer(taskId)
                    } else {
                        this.repository.fail(
                            taskId,
                            /^[A-Z_]{1,64}$/.test(message) ? message : 'THUMBNAIL_FAILED'
                        )
                    }
                }
            }
        } finally {
            this.processing = false
        }
    }

    private async proof(
        work: ThumbnailWork,
        path: string,
        links: 1n | 2n
    ): Promise<ThumbnailFileProof> {
        const info = await nodeStorageFileSystem.lstat(path)

        if (info.size <= 0n || info.size > BigInt(MAX_BYTES)) {
            throw new Error('THUMBNAIL_FILE_INVALID')
        }

        const paths = downloadThumbnailPaths(work)

        const inspected = await inspectDownloadFile(
            work.storageRoot,
            paths.directory,
            path,
            nodeStorageFileSystem,
            undefined,
            links
        )

        const bytes = await readBounded(path, links)
        const dimensions = (this.options.inspectJpeg ?? inspectThumbnailJpeg)(bytes)

        const hash = createHash('sha256').update(bytes).digest('hex')

        if (hash !== inspected.sha256 || bytes.length !== inspected.size) {
            throw new Error('THUMBNAIL_FILE_CHANGED')
        }

        return {
            path,
            realPath: inspected.realPath,
            size: inspected.size,
            sha256: inspected.sha256,
            device: inspected.device,
            inode: inspected.inode,
            mtimeNs: inspected.mtimeNs,
            ctimeNs: inspected.ctimeNs,
            ...dimensions
        }
    }

    private async process(work: ThumbnailWork): Promise<void> {
        const paths = downloadThumbnailPaths(work)

        const directories = new StorageDirectories(work.storageRoot, nodeStorageFileSystem)

        await directories.check(paths.directory, true)

        let artifact = work.artifact

        if (!artifact) {
            // 검증 기록이 없는 기존 파일은 채택하거나 삭제하지 않는다.
            if ((await exists(paths.stagedPath)) || (await exists(paths.finalPath))) {
                throw new Error('THUMBNAIL_UNVERIFIED_FILE')
            }

            const cachedPath = await this.previews.get(work.sourceUrl)

            if (!cachedPath) {
                throw new Error('THUMBNAIL_UNAVAILABLE')
            }

            const bytes = await readBounded(cachedPath)

            const inspectJpeg = this.options.inspectJpeg ?? inspectThumbnailJpeg

            inspectJpeg(bytes)

            const expectedHash = createHash('sha256').update(bytes).digest('hex')

            await directories.check(paths.directory)

            const handle = await open(paths.stagedPath, 'wx')

            try {
                await handle.writeFile(bytes)
                await handle.sync()
            } finally {
                await handle.close()
            }

            await nodeStorageFileSystem.syncDirectory(paths.directory)

            const prepared = await this.proof(work, paths.stagedPath, 1n)

            if (prepared.sha256 !== expectedHash) {
                throw new Error('THUMBNAIL_FILE_CHANGED')
            }

            // 최종 공개 전에 검증 결과를 영속화한다.
            this.repository.recordPrepared(work, prepared)
            artifact = prepared
        }

        const hasStaged = await exists(paths.stagedPath)
        const hasFinal = await exists(paths.finalPath)

        if (!hasStaged && !hasFinal) {
            throw new Error('THUMBNAIL_FILE_MISSING')
        }

        const links = hasStaged && hasFinal ? 2n : 1n

        if (hasStaged) {
            assertArtifact(artifact, await this.proof(work, paths.stagedPath, links))
        }

        if (hasFinal) {
            assertArtifact(artifact, await this.proof(work, paths.finalPath, links))
        }

        if (!hasFinal) {
            await directories.check(paths.directory)

            // 기존 최종 파일을 덮어쓰지 않는다.
            await nodeStorageFileSystem.link(paths.stagedPath, paths.finalPath)

            await nodeStorageFileSystem.syncDirectory(paths.directory)
        }

        if (hasStaged) {
            const staged = await this.proof(work, paths.stagedPath, 2n)

            const final = await this.proof(work, paths.finalPath, 2n)

            assertArtifact(artifact, staged)
            assertArtifact(artifact, final)

            await directories.check(paths.directory)

            assertCurrentFile(staged, await lstat(paths.stagedPath, { bigint: true }), 2n)

            assertCurrentFile(final, await lstat(paths.finalPath, { bigint: true }), 2n)

            await nodeStorageFileSystem.unlink(paths.stagedPath)
            await nodeStorageFileSystem.syncDirectory(paths.directory)
        }

        const final = await this.proof(work, paths.finalPath, 1n)

        assertArtifact(artifact, final)

        this.repository.complete(work, final)
    }
}
