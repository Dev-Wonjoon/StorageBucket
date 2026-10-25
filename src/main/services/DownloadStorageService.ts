import { randomUUID } from 'node:crypto'
import { link, mkdir, open, rename, unlink } from 'node:fs/promises'
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
    toNamespacedPath
} from 'node:path'
import {
    DownloadRepositoryError,
    type DownloadFileVerification
} from '../repositories/DownloadRepository'
import {
    type DownloadCommitPlan,
    type DownloadFinalFile,
    type DownloadCommitRepository
} from '../repositories/DownloadCommitRepository'
import {
    downloadStagingDirectory,
    inspectDownloadFile,
    nodeVerificationFileSystem,
    type VerificationFileSystem,
    type VerificationStat
} from './DownloadVerificationService'

export interface StorageFileSystem extends VerificationFileSystem {
    mkdir(path: string): Promise<void>
    link(source: string, destination: string): Promise<void>
    unlink(path: string): Promise<void>
    rename(source: string, destination: string): Promise<void>
    writeExclusive(path: string, content: string): Promise<void>
    syncFile(path: string): Promise<void>
    syncDirectory(path: string): Promise<void>
}

export const nodeStorageFileSystem: StorageFileSystem = {
    ...nodeVerificationFileSystem,

    mkdir: async (path) => {
        await mkdir(path)
    },

    link,
    unlink,
    rename,

    async writeExclusive(path, content) {
        const handle = await open(path, 'wx')

        try {
            await handle.writeFile(content, 'utf8')
            await handle.sync()
        } finally {
            await handle.close()
        }
    },

    async syncFile(path) {
        const handle = await open(path, 'r+')

        try {
            await handle.sync()
        } finally {
            await handle.close()
        }
    },

    async syncDirectory(path) {
        // Windows의 디렉터리 flush는 별도 네이티브 검증 대상이다.
        if (process.platform === 'win32') return

        const handle = await open(path, 'r')

        try {
            await handle.sync()
        } finally {
            await handle.close()
        }
    }
}

type Repository = Pick<DownloadCommitRepository, 'prepare' | 'begin' | 'complete'>

type Result = ReturnType<DownloadCommitRepository['complete']>

type Phase =
    | 'prepared'
    | 'directory_intent'
    | 'directory_ready'
    | 'link_intent'
    | 'unlink_intent'
    | 'file_ready'
    | 'db_commit_intent'
    | 'committed'

const active = new Set<string>()

function fail(code: ConstructorParameters<typeof DownloadRepositoryError>[0]): never {
    throw new DownloadRepositoryError(code)
}

function database<T>(action: () => T): T {
    try {
        return action()
    } catch (error) {
        if (error instanceof DownloadRepositoryError) throw error
        fail('DATABASE_ERROR')
    }
}

function ioCode(error: unknown) {
    return (error as { code?: unknown } | null)?.code
}

function pathKey(path: string) {
    const value = resolve(path)

    return process.platform === 'win32' ? toNamespacedPath(value).toLowerCase() : value
}

function same(a: VerificationStat, b: VerificationStat) {
    return (
        a.kind === b.kind &&
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeNs === b.mtimeNs &&
        a.ctimeNs === b.ctimeNs &&
        a.nlink === b.nlink
    )
}

function abort(signal?: AbortSignal) {
    if (signal?.aborted) fail('CANCEL_REQUESTED')
}

function matches(
    actual: Omit<DownloadFileVerification, 'targetId'>,
    expected: DownloadFileVerification,
    compareCtime = false
) {
    if (
        actual.size !== expected.size ||
        actual.sha256 !== expected.sha256 ||
        actual.device !== expected.device ||
        actual.inode !== expected.inode ||
        actual.mtimeNs !== expected.mtimeNs ||
        (compareCtime && actual.ctimeNs !== expected.ctimeNs)
    ) {
        fail('FILE_CHANGED')
    }
}

export class StorageDirectories {
    private readonly identities = new Map<string, string>()

    constructor(
        private root: string,
        private fs: StorageFileSystem
    ) {}

    async check(path: string, create = false) {
        const part = relative(this.root, path)

        if (part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) {
            fail('UNSAFE_STAGING_PATH')
        }

        let current = this.root
        const parts = part ? part.split(sep) : []

        for (let index = -1; index < parts.length; index++) {
            if (index >= 0) {
                current = join(current, parts[index])
            }

            let info: VerificationStat

            try {
                info = await this.fs.lstat(current)
            } catch (error) {
                if (!create || index < 0 || ioCode(error) !== 'ENOENT') {
                    throw error
                }

                try {
                    await this.fs.mkdir(current)
                    await this.fs.syncDirectory(dirname(current))
                } catch (error) {
                    if (ioCode(error) !== 'EEXIST') throw error
                }

                info = await this.fs.lstat(current)
            }

            if (
                info.kind !== 'directory' ||
                info.ino <= 0n ||
                pathKey(await this.fs.realpath(current)) !== pathKey(current)
            ) {
                fail('UNSAFE_STAGING_PATH')
            }

            const key = pathKey(current)
            const identity = info.dev + ':' + info.ino
            const previous = this.identities.get(key)

            if (previous !== undefined && previous !== identity) {
                fail('FILE_CHANGED')
            }

            this.identities.set(key, identity)
        }
    }
}

class Manifest {
    private stamp?: VerificationStat
    private readonly done: string[] = []

    constructor(
        private plan: DownloadCommitPlan,
        private fs: StorageFileSystem,
        private directories: StorageDirectories
    ) {}

    doneFile(id: string) {
        this.done.push(id)
    }

    private async check() {
        const info = await this.fs.lstat(this.plan.manifestPath)

        if (
            !this.stamp ||
            !same(info, this.stamp) ||
            info.kind !== 'file' ||
            info.nlink !== 1n ||
            pathKey(await this.fs.realpath(this.plan.manifestPath)) !==
                pathKey(this.plan.manifestPath)
        ) {
            fail('FILE_CHANGED')
        }
    }

    async save(phase: Phase, targetId?: string, result?: Result) {
        const plan = this.plan
        const parent = dirname(plan.manifestPath)

        await this.directories.check(parent, true)

        if (this.stamp) {
            await this.check()
        }

        // URL·쿠키·다운로드 옵션·원문 메타데이터는 복구 기록에 복사하지 않는다.
        const payload = {
            version: 1,
            jobId: plan.jobId,
            attemptId: plan.attemptId,
            mode: plan.mode,
            targetMediaId: plan.parent?.id ?? null,
            expectedRevision: plan.parent?.revision ?? null,
            phase,
            targetId,
            completedTargetIds: this.done,
            result,

            targets: plan.targets.map((target) => {
                const proof = JSON.parse(target.metadataJson)
                    .fileVerification as DownloadFileVerification

                return {
                    targetId: target.id,
                    position: target.position,
                    stagedPath: target.stagedPath,
                    finalPath: target.finalPath,
                    verification: {
                        size: proof.size,
                        device: proof.device,
                        inode: proof.inode,
                        mtimeNs: proof.mtimeNs,
                        ctimeNs: proof.ctimeNs,
                        sha256: proof.sha256
                    }
                }
            }),

            oldFiles: plan.oldFiles.map((file) => ({
                fileId: file.id,
                path: file.filepath,
                storageKind: file.storageKind,
                thumbnailPath: file.thumbnailPath,
                thumbnailOrigin: file.thumbnailOrigin,
                previewPath: file.previewPath
            }))
        }

        const temporary = plan.manifestPath + '.' + randomUUID() + '.tmp'

        await this.fs.writeExclusive(temporary, JSON.stringify(payload))

        const written = await this.fs.lstat(temporary)

        if (written.kind !== 'file' || written.nlink !== 1n) {
            fail('FILE_CHANGED')
        }

        await this.directories.check(parent)

        if (!this.stamp) {
            // 첫 공개는 배타적 hard link로 수행해 기존 manifest를 덮어쓰지 않는다.
            try {
                await this.fs.link(temporary, plan.manifestPath)
            } catch (error) {
                if (ioCode(error) === 'EEXIST') {
                    fail('MANIFEST_EXISTS')
                }

                throw error
            }

            await this.fs.unlink(temporary)
        } else {
            await this.check()

            // 교체 대상은 이번 실행이 직접 만든 manifest뿐이다.
            await this.fs.rename(temporary, plan.manifestPath)
        }

        await this.fs.syncDirectory(parent)
        await this.directories.check(parent)

        const installed = await this.fs.lstat(plan.manifestPath)

        if (
            installed.kind !== 'file' ||
            installed.dev !== written.dev ||
            installed.ino !== written.ino ||
            installed.nlink !== 1n
        ) {
            fail('FILE_CHANGED')
        }

        this.stamp = installed
    }
}

export class DownloadStorageService {
    private readonly root: string

    constructor(
        private repository: Repository,
        storageRoot: string,
        private fs: StorageFileSystem = nodeStorageFileSystem
    ) {
        if (!isAbsolute(storageRoot) || storageRoot.includes('\0')) {
            fail('INVALID_ARGUMENT')
        }

        this.root = resolve(storageRoot)
    }

    async finalize(jobId: string, attemptId: string, signal?: AbortSignal) {
        abort(signal)

        const ownerKey = JSON.stringify([pathKey(this.root), jobId, attemptId])

        if (active.has(ownerKey)) {
            fail('ALREADY_PROCESSING')
        }

        active.add(ownerKey)

        try {
            const plan = database(() => this.repository.prepare(jobId, attemptId))

            const staging = downloadStagingDirectory(this.root, jobId, attemptId)

            const base = join(this.root, '.storagebucket')
            const owner = basename(staging)
            const finalDirectory = join(base, 'files', owner)

            if (
                plan.manifestPath !== join(base, 'manifests', owner + '.json') ||
                !plan.targets.length ||
                plan.targets.some((target) => dirname(target.finalPath) !== finalDirectory)
            ) {
                fail('UNSAFE_STAGING_PATH')
            }

            const directories = new StorageDirectories(this.root, this.fs)

            await directories.check(this.root)

            for (const target of plan.targets) {
                abort(signal)

                const proof = await inspectDownloadFile(
                    this.root,
                    staging,
                    target.stagedPath,
                    this.fs,
                    signal
                )

                matches(proof, JSON.parse(target.metadataJson).fileVerification, true)
            }

            const journal = new Manifest(plan, this.fs, directories)

            await journal.save('prepared')
            abort(signal)

            database(() => this.repository.begin(plan))

            // committing 진입 뒤에는 AbortSignal로 완료 절차를 취소하지 않는다.
            await journal.save('directory_intent')
            await directories.check(dirname(finalDirectory), true)

            // 이번 시도의 최종 폴더도 기존 폴더를 재사용하지 않는다.
            await this.fs.mkdir(finalDirectory)
            await this.fs.syncDirectory(dirname(finalDirectory))
            await directories.check(finalDirectory)
            await journal.save('directory_ready')

            for (const target of plan.targets) {
                const expected = JSON.parse(target.metadataJson)
                    .fileVerification as DownloadFileVerification

                const before = await inspectDownloadFile(
                    this.root,
                    staging,
                    target.stagedPath,
                    this.fs
                )

                matches(before, expected, true)

                await this.fs.syncFile(target.stagedPath)
                await journal.save('link_intent', target.id)

                await directories.check(dirname(target.stagedPath))
                await directories.check(finalDirectory)

                const source = await this.fs.lstat(target.stagedPath)

                if (
                    source.kind !== 'file' ||
                    source.nlink !== 1n ||
                    source.dev.toString() !== expected.device ||
                    source.ino.toString() !== expected.inode ||
                    source.size !== BigInt(expected.size) ||
                    source.mtimeNs.toString() !== expected.mtimeNs ||
                    source.ctimeNs.toString() !== expected.ctimeNs
                ) {
                    fail('FILE_CHANGED')
                }

                // 기존 목적지가 있으면 실패한다.
                // 일반 rename으로 대체하지 않는다.
                await this.fs.link(target.stagedPath, target.finalPath)

                await this.fs.syncDirectory(finalDirectory)
                await journal.save('unlink_intent', target.id)

                await directories.check(dirname(target.stagedPath))
                await directories.check(finalDirectory)

                const from = await this.fs.lstat(target.stagedPath)
                const to = await this.fs.lstat(target.finalPath)

                if (
                    !same(from, to) ||
                    from.kind !== 'file' ||
                    from.nlink !== 2n ||
                    from.dev.toString() !== expected.device ||
                    from.ino.toString() !== expected.inode ||
                    from.size !== BigInt(expected.size) ||
                    from.mtimeNs.toString() !== expected.mtimeNs ||
                    pathKey(await this.fs.realpath(target.stagedPath)) !==
                        pathKey(target.stagedPath) ||
                    pathKey(await this.fs.realpath(target.finalPath)) !== pathKey(target.finalPath)
                ) {
                    fail('FILE_CHANGED')
                }

                await this.fs.unlink(target.stagedPath)
                await this.fs.syncDirectory(dirname(target.stagedPath))

                const final = await inspectDownloadFile(
                    this.root,
                    finalDirectory,
                    target.finalPath,
                    this.fs
                )

                matches(final, expected)

                journal.doneFile(target.id)
                await journal.save('file_ready', target.id)
            }

            await journal.save('db_commit_intent')

            // 뒤쪽 파일을 처리하는 동안 앞쪽 파일이 바뀌었는지도 다시 검사한다.
            const files: DownloadFinalFile[] = []

            for (const target of plan.targets) {
                const proof = await inspectDownloadFile(
                    this.root,
                    finalDirectory,
                    target.finalPath,
                    this.fs
                )

                matches(proof, JSON.parse(target.metadataJson).fileVerification)

                const { stagedPath: _path, ...file } = proof

                files.push({
                    ...file,
                    targetId: target.id,
                    finalPath: target.finalPath
                })
            }

            let result: Result

            try {
                result = this.repository.complete(plan, files)
            } catch {
                // 커밋 응답이 유실됐을 수도 있으므로 파일을 보존하고 복구 판정에 맡긴다.
                fail('COMMIT_STATE_UNKNOWN')
            }

            try {
                await journal.save('committed', undefined, result)

                return {
                    ...result,
                    manifestFinalized: true
                }
            } catch {
                // DB 완료는 확정됐다.
                // manifest 보완 실패로 다운로드를 실패로 되돌리지 않는다.
                return {
                    ...result,
                    manifestFinalized: false
                }
            }
        } catch (error) {
            // 실패해도 파일을 자동 삭제하지 않는다.
            // 미완료 attempt/manifest가 재실행을 막는다.
            if (error instanceof DownloadRepositoryError) {
                throw error
            }

            const code = ioCode(error)

            throw new DownloadRepositoryError(
                code === 'ENOENT' || code === 'ENOTDIR'
                    ? 'FILE_NOT_FOUND'
                    : code === 'EEXIST'
                      ? 'TARGET_PATH_COLLISION'
                      : 'FILE_IO_ERROR'
            )
        } finally {
            active.delete(ownerKey)
        }
    }
}
