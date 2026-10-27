import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep, toNamespacedPath } from 'node:path'
import {
    DownloadRepository,
    DownloadRepositoryError,
    type DownloadFileVerification
} from './DownloadRepository'

export interface VerificationStat {
    kind: 'file' | 'directory' | 'link' | 'other'
    size: bigint
    mtimeNs: bigint
    ctimeNs: bigint
    dev: bigint
    ino: bigint
    nlink: bigint
}

export interface VerificationHandle {
    stat(): Promise<VerificationStat>
    read(buffer: Buffer): Promise<number>
    close(): Promise<void>
}

export interface VerificationFileSystem {
    lstat(path: string): Promise<VerificationStat>
    realpath(path: string): Promise<string>
    open(path: string): Promise<VerificationHandle>
}

function stamp(value: BigIntStats): VerificationStat {
    return {
        kind: value.isSymbolicLink()
            ? 'link'
            : value.isFile()
              ? 'file'
              : value.isDirectory()
                ? 'directory'
                : 'other',
        size: value.size,
        mtimeNs: value.mtimeNs,
        ctimeNs: value.ctimeNs,
        dev: value.dev,
        ino: value.ino,
        nlink: value.nlink
    }
}

export const nodeVerificationFileSystem: VerificationFileSystem = {
    lstat: async (path) => stamp(await lstat(path, { bigint: true })),

    realpath,

    async open(path) {
        const handle = await open(path, 'r')

        return {
            stat: async () => stamp(await handle.stat({ bigint: true })),

            read: async (buffer) => (await handle.read(buffer, 0, buffer.length, null)).bytesRead,

            close: () => handle.close()
        }
    }
}

function invalidPath(): never {
    throw new DownloadRepositoryError('UNSAFE_STAGING_PATH')
}

function absolute(value: string): string {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
        invalidPath()
    }

    return resolve(value)
}

function key(value: string): string {
    const path = resolve(value)

    return process.platform === 'win32' ? toNamespacedPath(path).toLowerCase() : path
}

function child(parent: string, path: string) {
    const part = relative(parent, path)

    if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) {
        invalidPath()
    }

    if (
        process.platform === 'win32' &&
        part
            .split(sep)
            .some(
                (segment) =>
                    /[<>:"|?*\x00-\x1f]/.test(segment) ||
                    /[ .]$/.test(segment) ||
                    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
            )
    ) {
        invalidPath()
    }
}

export function downloadStagingDirectory(
    storageRoot: string,
    jobId: string,
    attemptId: string
): string {
    if (
        typeof jobId !== 'string' ||
        !jobId.trim() ||
        typeof attemptId !== 'string' ||
        !attemptId.trim()
    ) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    const owner = createHash('sha256')
        .update(JSON.stringify([jobId, attemptId]))
        .digest('hex')

    return join(absolute(storageRoot), '.storagebucket', 'staging', owner)
}

function sameFile(a: VerificationStat, b: VerificationStat) {
    return (
        a.kind === 'file' &&
        b.kind === 'file' &&
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeNs === b.mtimeNs &&
        a.ctimeNs === b.ctimeNs &&
        a.nlink === b.nlink
    )
}

function cancelled(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DownloadRepositoryError('CANCEL_REQUESTED')
    }
}

export async function inspectDownloadFile(
    storageRoot: string,
    stagingRoot: string,
    candidate: string,
    fs: VerificationFileSystem,
    signal?: AbortSignal,
    allowedLinkCount: 1n | 2n = 1n
): Promise<Omit<DownloadFileVerification, 'targetId'>> {
    if (allowedLinkCount !== 1n && allowedLinkCount !== 2n) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    const root = absolute(storageRoot)
    const stagedPath = absolute(candidate)

    child(root, stagingRoot)
    child(stagingRoot, stagedPath)

    async function walk() {
        const chain: VerificationStat[] = []
        let current = root

        const parts = relative(root, stagedPath).split(sep)

        for (let index = -1; index < parts.length; index++) {
            cancelled(signal)

            if (index >= 0) {
                current = join(current, parts[index])
            }

            const info = await fs.lstat(current)

            if (info.kind === 'link') {
                invalidPath()
            }

            if (key(await fs.realpath(current)) !== key(current)) {
                invalidPath()
            }

            if (info.ino <= 0n) {
                throw new DownloadRepositoryError('FILE_IO_ERROR')
            }

            const last = index === parts.length - 1

            if (!last && info.kind !== 'directory') {
                invalidPath()
            }

            if (last && info.kind !== 'file') {
                throw new DownloadRepositoryError('FILE_NOT_REGULAR')
            }

            if (last && info.nlink !== allowedLinkCount) {
                invalidPath()
            }

            chain.push(info)
        }

        return {
            chain,
            file: chain[chain.length - 1]
        }
    }

    const before = await walk()

    if (before.file.size <= 0n) {
        throw new DownloadRepositoryError('FILE_EMPTY')
    }

    if (before.file.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new DownloadRepositoryError('FILE_IO_ERROR')
    }

    const handle = await fs.open(stagedPath)

    try {
        if (!sameFile(before.file, await handle.stat())) {
            throw new DownloadRepositoryError('FILE_CHANGED')
        }

        const hash = createHash('sha256')
        const buffer = Buffer.allocUnsafe(512 * 1024)
        let bytes = 0

        for (;;) {
            cancelled(signal)

            const count = await handle.read(buffer)

            if (!Number.isInteger(count) || count < 0 || count > buffer.length) {
                throw new DownloadRepositoryError('FILE_IO_ERROR')
            }

            if (count === 0) break

            bytes += count

            if (bytes > Number(before.file.size)) {
                throw new DownloadRepositoryError('FILE_CHANGED')
            }

            hash.update(buffer.subarray(0, count))
        }

        if (bytes !== Number(before.file.size) || !sameFile(before.file, await handle.stat())) {
            throw new DownloadRepositoryError('FILE_CHANGED')
        }

        const after = await walk()

        if (
            !sameFile(before.file, after.file) ||
            before.chain.length !== after.chain.length ||
            before.chain.some(
                (item, index) =>
                    item.dev !== after.chain[index].dev || item.ino !== after.chain[index].ino
            )
        ) {
            throw new DownloadRepositoryError('FILE_CHANGED')
        }

        const realPath = await fs.realpath(stagedPath)

        if (key(realPath) !== key(stagedPath)) {
            invalidPath()
        }

        return {
            stagedPath,
            realPath,
            size: bytes,
            mtimeNs: before.file.mtimeNs.toString(),
            ctimeNs: before.file.ctimeNs.toString(),
            device: before.file.dev.toString(),
            inode: before.file.ino.toString(),
            sha256: hash.digest('hex')
        }
    } finally {
        await handle.close()
    }
}

export class DownloadVerificationService {
    private readonly active = new Set<string>()

    constructor(
        private readonly repository: DownloadRepository,
        private readonly storageRoot: string,
        private readonly fs: VerificationFileSystem = nodeVerificationFileSystem
    ) {}

    async verify(jobId: string, attemptId: string, signal?: AbortSignal) {
        cancelled(signal)

        const owner = JSON.stringify([jobId, attemptId])

        if (this.active.has(owner)) {
            throw new DownloadRepositoryError('ALREADY_PROCESSING')
        }

        this.active.add(owner)

        try {
            const snapshot = this.repository.verificationSnapshot(jobId, attemptId)

            const stagingRoot = downloadStagingDirectory(this.storageRoot, jobId, attemptId)

            const files: DownloadFileVerification[] = []

            for (const target of snapshot.targets) {
                cancelled(signal)

                try {
                    const file = await inspectDownloadFile(
                        this.storageRoot,
                        stagingRoot,
                        target.stagedPath,
                        this.fs,
                        signal
                    )

                    files.push({
                        targetId: target.id,
                        ...file
                    })
                } catch (error) {
                    if (error instanceof DownloadRepositoryError) {
                        throw error
                    }

                    const code = (
                        error as {
                            code?: unknown
                        } | null
                    )?.code

                    throw new DownloadRepositoryError(
                        code === 'ENOENT' || code === 'ENOTDIR'
                            ? 'FILE_NOT_FOUND'
                            : code === 'ELOOP'
                              ? 'UNSAFE_STAGING_PATH'
                              : 'FILE_IO_ERROR'
                    )
                }
            }

            cancelled(signal)

            return this.repository.markVerified(snapshot, files)
        } catch (error) {
            if (error instanceof DownloadRepositoryError) {
                throw error
            }

            throw new DownloadRepositoryError('DATABASE_ERROR')
        } finally {
            this.active.delete(owner)
        }
    }
}
