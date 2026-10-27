import { randomUUID } from 'node:crypto'
import { opendir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, toNamespacedPath } from 'node:path'
import type { DownloadAttemptContext, DownloadWorkspacePort } from './DownloadAdapter'
import type { DownloadWorkspaceRepository } from './DownloadWorkspaceRepository'
import { DownloadRepositoryError } from './DownloadRepository'
import { downloadStagingDirectory, type VerificationStat } from './DownloadVerificationService'
import {
    StorageDirectories,
    nodeStorageFileSystem,
    type StorageFileSystem
} from './DownloadStorageService'

export interface WorkspaceFileSystem extends StorageFileSystem {
    emptyDirectory(path: string): Promise<boolean>
}

export const nodeWorkspaceFileSystem: WorkspaceFileSystem = {
    ...nodeStorageFileSystem,

    async emptyDirectory(path) {
        const directory = await opendir(path)

        try {
            return (await directory.read()) === null
        } finally {
            await directory.close()
        }
    }
}

type Repository = Pick<DownloadWorkspaceRepository, 'snapshot' | 'assertCurrent'>

const active = new Set<string>()

function fail(code: ConstructorParameters<typeof DownloadRepositoryError>[0]): never {
    throw new DownloadRepositoryError(code)
}

function key(path: string) {
    const value = resolve(path)

    return process.platform === 'win32' ? toNamespacedPath(value).toLowerCase() : value
}

function database<T>(action: () => T): T {
    try {
        return action()
    } catch (error) {
        if (error instanceof DownloadRepositoryError) {
            throw error
        }

        fail('DATABASE_ERROR')
    }
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

export class DownloadWorkspaceService implements DownloadWorkspacePort {
    private readonly root: string

    constructor(
        private repository: Repository,
        storageRoot: string,
        private fs: WorkspaceFileSystem = nodeWorkspaceFileSystem
    ) {
        if (!isAbsolute(storageRoot) || storageRoot.includes('\0')) {
            fail('INVALID_ARGUMENT')
        }

        this.root = resolve(storageRoot)
    }

    async prepare(context: Readonly<DownloadAttemptContext>): Promise<void> {
        if (!context || typeof context !== 'object') {
            fail('INVALID_ARGUMENT')
        }

        const { jobId, attemptId, stagingDirectory } = context

        const expected = downloadStagingDirectory(this.root, jobId, attemptId)

        if (stagingDirectory !== expected) {
            fail('UNSAFE_STAGING_PATH')
        }

        const lock = JSON.stringify([key(this.root), jobId, attemptId])

        if (active.has(lock)) {
            fail('ALREADY_PROCESSING')
        }

        active.add(lock)

        try {
            const snapshot = database(() => this.repository.snapshot(jobId, attemptId))

            const owner = basename(expected)
            const base = join(this.root, '.storagebucket')
            const recordDirectory = join(base, 'attempts', owner)
            const commitManifestPath = join(base, 'manifests', owner + '.json')

            const directories = new StorageDirectories(this.root, this.fs)

            await directories.check(dirname(recordDirectory), true)
            await directories.check(dirname(expected), true)

            try {
                await this.fs.mkdir(recordDirectory)
            } catch (error) {
                if ((error as { code?: string }).code === 'EEXIST') {
                    fail('MANIFEST_EXISTS')
                }

                throw error
            }

            await this.fs.syncDirectory(dirname(recordDirectory))
            await directories.check(recordDirectory)

            const payload = {
                version: 1,
                kind: 'download_workspace',
                jobId: snapshot.jobId,
                attemptId: snapshot.attemptId,
                requestUrlId: snapshot.requestUrlId,
                mode: snapshot.mode,
                targetMediaIdSnapshot: snapshot.targetMediaIdSnapshot,
                stagingDirectory: expected,
                commitManifestPath
            }

            const intentPath = join(recordDirectory, 'intent.json')

            const intent = await this.publish(
                intentPath,
                {
                    ...payload,
                    phase: 'preparing'
                },
                directories
            )

            database(() => this.repository.assertCurrent(snapshot))

            await directories.check(dirname(expected))

            try {
                await this.fs.mkdir(expected)
            } catch (error) {
                if ((error as { code?: string }).code === 'EEXIST') {
                    fail('TARGET_PATH_COLLISION')
                }

                throw error
            }

            await this.fs.syncDirectory(dirname(expected))
            await directories.check(expected)

            if (!(await this.fs.emptyDirectory(expected))) {
                fail('FILE_CHANGED')
            }

            const staging = await this.fs.lstat(expected)
            const readyPath = join(recordDirectory, 'ready.json')

            const ready = await this.publish(
                readyPath,
                {
                    ...payload,
                    phase: 'ready',
                    stagingIdentity: {
                        device: staging.dev.toString(),
                        inode: staging.ino.toString()
                    }
                },
                directories
            )

            await directories.check(expected)

            const current = await this.fs.lstat(expected)

            if (
                current.kind !== 'directory' ||
                current.dev !== staging.dev ||
                current.ino !== staging.ino ||
                !(await this.fs.emptyDirectory(expected))
            ) {
                fail('FILE_CHANGED')
            }

            await this.checkRecord(intentPath, intent, directories)
            await this.checkRecord(readyPath, ready, directories)

            database(() => this.repository.assertCurrent(snapshot))
        } catch (error) {
            // 기록과 staging을 보존한다.
            // 재개 여부는 DB와 복구 처리로 판정한다.
            if (error instanceof DownloadRepositoryError) {
                throw error
            }

            const code = (error as { code?: string } | null)?.code

            throw new DownloadRepositoryError(
                code === 'ENOENT' || code === 'ENOTDIR'
                    ? 'FILE_NOT_FOUND'
                    : code === 'ELOOP'
                      ? 'UNSAFE_STAGING_PATH'
                      : 'FILE_IO_ERROR'
            )
        } finally {
            active.delete(lock)
        }
    }

    private async publish(path: string, payload: unknown, directories: StorageDirectories) {
        const parent = dirname(path)

        await directories.check(parent)

        const temporary = path + '.' + randomUUID() + '.tmp'

        await this.fs.writeExclusive(temporary, JSON.stringify(payload))

        const written = await this.fs.lstat(temporary)

        if (
            written.kind !== 'file' ||
            written.ino <= 0n ||
            written.nlink !== 1n ||
            key(await this.fs.realpath(temporary)) !== key(temporary)
        ) {
            fail('FILE_CHANGED')
        }

        await directories.check(parent)

        try {
            await this.fs.link(temporary, path)
        } catch (error) {
            if ((error as { code?: string }).code === 'EEXIST') {
                fail('MANIFEST_EXISTS')
            }

            throw error
        }

        await this.fs.syncDirectory(parent)
        await directories.check(parent)

        const from = await this.fs.lstat(temporary)
        const to = await this.fs.lstat(path)

        if (
            !same(from, to) ||
            from.kind !== 'file' ||
            from.nlink !== 2n ||
            from.dev !== written.dev ||
            from.ino !== written.ino ||
            from.size !== written.size ||
            from.mtimeNs !== written.mtimeNs ||
            key(await this.fs.realpath(path)) !== key(path)
        ) {
            fail('FILE_CHANGED')
        }

        await this.fs.unlink(temporary)
        await this.fs.syncDirectory(parent)
        await directories.check(parent)

        const installed = await this.fs.lstat(path)

        if (
            installed.kind !== 'file' ||
            installed.nlink !== 1n ||
            installed.dev !== written.dev ||
            installed.ino !== written.ino ||
            installed.size !== written.size ||
            installed.mtimeNs !== written.mtimeNs
        ) {
            fail('FILE_CHANGED')
        }

        return installed
    }

    private async checkRecord(
        path: string,
        expected: VerificationStat,
        directories: StorageDirectories
    ) {
        await directories.check(dirname(path))

        const actual = await this.fs.lstat(path)

        if (
            !same(actual, expected) ||
            actual.kind !== 'file' ||
            actual.nlink !== 1n ||
            key(await this.fs.realpath(path)) !== key(path)
        ) {
            fail('FILE_CHANGED')
        }
    }
}
