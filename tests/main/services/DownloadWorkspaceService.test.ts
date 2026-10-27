import assert from 'node:assert/strict'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    symlink,
    writeFile
} from 'node:fs/promises'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import type { V2Database } from '@features/media/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError,
    type DownloadResultInput
} from '@features/download/DownloadRepository'
import { DownloadCommitRepository } from '@features/download/DownloadCommitRepository'
import { DownloadRecoveryRepository } from '@features/download/DownloadRecoveryRepository'
import { DownloadCleanupRepository } from '@features/download/DownloadCleanupRepository'
import { DownloadCleanupService } from '@features/download/DownloadCleanupService'
import { DownloadWorkspaceRepository } from '@features/download/DownloadWorkspaceRepository'
import {
    DownloadWorkspaceService,
    nodeWorkspaceFileSystem,
    type WorkspaceFileSystem
} from '@features/download/DownloadWorkspaceService'
import {
    DownloadVerificationService,
    downloadStagingDirectory
} from '@features/download/DownloadVerificationService'
import { DownloadStorageService } from '@features/download/DownloadStorageService'
import { DownloadRunner } from '@features/download/DownloadRunner'
import type { DownloadAttemptContext } from '@features/download/DownloadAdapter'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let workspace: DownloadWorkspaceRepository
let root: string | undefined
let parent: string
let serial: number

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(async () => {
    root = undefined
    parent = await realpath(tmpdir())
    root = await mkdtemp(join(parent, 'storagebucket-workspace-'))

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    repo = new DownloadRepository(db)
    workspace = new DownloadWorkspaceRepository(db)
    serial = 0
})

afterEach(async () => {
    try {
        if (sqlite?.open) {
            assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
        }
    } finally {
        if (sqlite?.open) sqlite.close()

        const owned = root
        root = undefined

        if (owned) {
            assert.equal(resolve(owned), owned)
            assert.equal(dirname(owned), parent)
            assert.ok(basename(owned).startsWith('storagebucket-workspace-'))

            await rm(owned, {
                recursive: true,
                force: true
            })
        }
    }
})

const error = (code: string) => (value: unknown) =>
    value instanceof DownloadRepositoryError && value.code === code

const fault = () => Object.assign(new Error('private filesystem detail'), { code: 'EIO' })

function queued(replace = false) {
    const url = 'https://example.invalid/' + ++serial + '?secret=private'

    const request = db
        .insert(s.downloadUrls)
        .values({
            url,
            normalizedUrl: url,
            normalizationVersion: 1
        })
        .returning()
        .get()

    const media = replace
        ? db
              .insert(s.medias)
              .values({
                  sourceKind: 'download',
                  requestUrlId: request.id,
                  customTitle: 'private title'
              })
              .returning()
              .get()
        : undefined

    if (media) {
        db.insert(s.mediaFiles)
            .values({
                mediaId: media.id,
                fileKey: 'old',
                kind: 'image',
                position: 0,
                filepath: join(root!, 'old.png'),
                storageKind: 'unverified_legacy'
            })
            .run()
    }

    const job = repo.enqueue(
        media
            ? {
                  requestUrlId: request.id,
                  originalUrl: url,
                  mode: 'replace',
                  mediaId: media.id,
                  expectedRevision: media.revision
              }
            : {
                  requestUrlId: request.id,
                  originalUrl: url,
                  mode: 'create'
              }
    )

    return { job, media }
}

function started(replace = false) {
    const value = queued(replace)

    const { attempt } = repo.startAttempt(value.job.id, 'manual_initial')

    return {
        ...value,
        context: {
            jobId: value.job.id,
            attemptId: attempt.id,
            stagingDirectory: downloadStagingDirectory(root!, value.job.id, attempt.id)
        }
    }
}

function paths(context: DownloadAttemptContext) {
    const owner = basename(context.stagingDirectory)
    const records = join(root!, '.storagebucket', 'attempts', owner)

    return {
        records,
        intent: join(records, 'intent.json'),
        ready: join(records, 'ready.json'),
        commit: join(root!, '.storagebucket', 'manifests', owner + '.json')
    }
}

function service(fs: WorkspaceFileSystem = nodeWorkspaceFileSystem) {
    return new DownloadWorkspaceService(workspace, root!, fs)
}

const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

describe('DownloadWorkspaceService', () => {
    it('intent를 먼저 공개하고 전용 staging 생성 후 ready를 공개한다', async () => {
        const { context } = started()
        const p = paths(context)
        const events: string[] = []

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async mkdir(path) {
                if (path === context.stagingDirectory) {
                    assert.equal((await json(p.intent)).phase, 'preparing')
                    events.push('staging')
                }

                await nodeWorkspaceFileSystem.mkdir(path)
            },

            async link(from, to) {
                await nodeWorkspaceFileSystem.link(from, to)

                if (to === p.intent) events.push('intent')
                if (to === p.ready) events.push('ready')
            }
        }

        await service(fs).prepare(context)

        assert.deepEqual(events, ['intent', 'staging', 'ready'])
        assert.deepEqual((await readdir(p.records)).sort(), ['intent.json', 'ready.json'])
        assert.deepEqual(await readdir(context.stagingDirectory), [])

        const ready = await json(p.ready)
        const info = await lstat(context.stagingDirectory, { bigint: true })

        assert.deepEqual(ready.stagingIdentity, {
            device: String(info.dev),
            inode: String(info.ino)
        })
        assert.equal(ready.commitManifestPath, p.commit)
        assert.equal(db.select().from(s.downloadAttempts).get()!.manifestPath, null)
    })

    it('URL·옵션·제목·추가 입력의 비밀 정보를 기록에 복사하지 않는다', async () => {
        const { context, media } = started(true)

        await service().prepare({
            ...context,
            cookie: 'private cookie'
        } as DownloadAttemptContext)

        const p = paths(context)
        const ready = await json(p.ready)

        assert.equal(ready.targetMediaIdSnapshot, media!.id)

        const text = (await readFile(p.intent, 'utf8')) + (await readFile(p.ready, 'utf8'))

        assert.ok(!text.includes('private'))
        assert.ok(!text.includes('https://'))
    })

    it('첫 기록 실패 후에는 staging을 생성하지 않는다', async () => {
        const { context } = started()

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive() {
                throw fault()
            }
        }

        await assert.rejects(service(fs).prepare(context), error('FILE_IO_ERROR'))
        await assert.rejects(lstat(context.stagingDirectory), { code: 'ENOENT' })
    })

    it('intent 공개 뒤 임시 이름 제거가 실패하면 기록을 보존하고 중단한다', async () => {
        const { context } = started()
        const p = paths(context)

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async unlink(path) {
                if (path.includes('intent.json.')) {
                    throw fault()
                }

                await nodeWorkspaceFileSystem.unlink(path)
            }
        }

        await assert.rejects(service(fs).prepare(context), error('FILE_IO_ERROR'))
        assert.equal((await json(p.intent)).phase, 'preparing')
        await assert.rejects(lstat(context.stagingDirectory), { code: 'ENOENT' })
    })

    it('ready 기록 실패는 intent와 빈 staging을 보존한다', async () => {
        const { context } = started()
        const p = paths(context)

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive(path, text) {
                if (JSON.parse(text).phase === 'ready') {
                    throw fault()
                }

                await nodeWorkspaceFileSystem.writeExclusive(path, text)
            }
        }

        await assert.rejects(service(fs).prepare(context), error('FILE_IO_ERROR'))
        assert.equal((await json(p.intent)).phase, 'preparing')
        assert.deepEqual(await readdir(context.stagingDirectory), [])
        await assert.rejects(lstat(p.ready), { code: 'ENOENT' })
    })

    it('기존 실행 기록과 staging을 재사용하거나 덮어쓰지 않는다', async () => {
        const { context } = started()

        await service().prepare(context)

        const keep = join(context.stagingDirectory, 'keep')
        await writeFile(keep, 'original')

        const before = await readFile(paths(context).intent, 'utf8')

        await assert.rejects(service().prepare(context), error('MANIFEST_EXISTS'))

        assert.equal(await readFile(keep, 'utf8'), 'original')
        assert.equal(await readFile(paths(context).intent, 'utf8'), before)
    })

    it('기존 staging이 있으면 기록을 남기되 파일에는 손대지 않는다', async () => {
        const { context } = started()

        await mkdir(context.stagingDirectory, { recursive: true })
        await writeFile(join(context.stagingDirectory, 'keep'), 'original')

        await assert.rejects(service().prepare(context), error('TARGET_PATH_COLLISION'))

        assert.equal(await readFile(join(context.stagingDirectory, 'keep'), 'utf8'), 'original')
        assert.equal((await json(paths(context).intent)).phase, 'preparing')
    })

    it('다른 staging 경로는 파일 접근 전에 거절한다', async () => {
        const { context } = started()
        let count = 0

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async lstat(path) {
                count++
                return nodeWorkspaceFileSystem.lstat(path)
            }
        }

        await assert.rejects(
            service(fs).prepare({
                ...context,
                stagingDirectory: root!
            }),
            error('UNSAFE_STAGING_PATH')
        )

        assert.equal(count, 0)
    })

    it('DB에서 수락한 시각 0 취소는 파일 접근 전에 거절한다', async () => {
        const { context } = started()

        db.update(s.downloadAttempts)
            .set({ cancelRequestedAt: 0 })
            .where(eq(s.downloadAttempts.id, context.attemptId))
            .run()

        await assert.rejects(service().prepare(context), error('CANCEL_REQUESTED'))
        await assert.rejects(lstat(paths(context).records), { code: 'ENOENT' })
    })

    it('잘못된 현재 상태와 다른 작업의 attempt를 거절한다', async () => {
        const first = started()
        const second = started()

        assert.throws(
            () => workspace.snapshot(first.context.jobId, second.context.attemptId),
            error('NOT_FOUND')
        )

        db.update(s.downloadQueue)
            .set({ state: 'pending' })
            .where(eq(s.downloadQueue.id, first.context.jobId))
            .run()

        await assert.rejects(service().prepare(first.context), error('INVALID_STATE'))
    })

    it('intent 기록 중 수락한 취소는 staging 생성 전에 재검사한다', async () => {
        const { context } = started()
        const commits = new DownloadCommitRepository(db, root!)

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive(path, text) {
                await nodeWorkspaceFileSystem.writeExclusive(path, text)

                if (JSON.parse(text).phase === 'preparing') {
                    commits.requestCancel(context.jobId, context.attemptId)
                }
            }
        }

        await assert.rejects(service(fs).prepare(context), error('CANCEL_REQUESTED'))
        assert.equal((await json(paths(context).intent)).phase, 'preparing')
        await assert.rejects(lstat(context.stagingDirectory), { code: 'ENOENT' })
    })

    it('준비 도중 사용자 제목·revision 변경은 허용하고 기록에 덮어쓰지 않는다', async () => {
        const { context, media } = started(true)

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive(path, text) {
                if (JSON.parse(text).phase === 'ready') {
                    db.update(s.medias)
                        .set({
                            customTitle: 'edited',
                            revision: 1
                        })
                        .where(eq(s.medias.id, media!.id))
                        .run()
                }

                await nodeWorkspaceFileSystem.writeExclusive(path, text)
            }
        }

        await service(fs).prepare(context)

        assert.equal(db.select().from(s.medias).get()!.customTitle, 'edited')
        assert.equal(db.select().from(s.medias).get()!.revision, 1)
    })

    it('공유 기록 폴더의 정션을 따라가 외부 경로에 기록하지 않는다', async () => {
        const { context } = started()
        const outside = join(root!, 'outside')

        await mkdir(outside)
        await mkdir(join(root!, '.storagebucket'))

        await symlink(
            outside,
            join(root!, '.storagebucket', 'attempts'),
            process.platform === 'win32' ? 'junction' : 'dir'
        )

        await assert.rejects(service().prepare(context), error('UNSAFE_STAGING_PATH'))
        assert.deepEqual(await readdir(outside), [])
    })

    it('준비 도중 staging 폴더가 교체되면 ready를 성공으로 반환하지 않는다', async () => {
        const { context } = started()

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive(path, text) {
                if (JSON.parse(text).phase === 'ready') {
                    await rename(context.stagingDirectory, join(root!, 'saved-staging'))
                    await mkdir(context.stagingDirectory)
                }

                await nodeWorkspaceFileSystem.writeExclusive(path, text)
            }
        }

        await assert.rejects(service(fs).prepare(context), error('FILE_CHANGED'))
    })

    it('ready 기록 도중 예상 밖 파일이 생겨도 성공으로 반환하지 않는다', async () => {
        const { context } = started()
        const keep = join(context.stagingDirectory, 'unexpected')

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive(path, text) {
                if (JSON.parse(text).phase === 'ready') {
                    await writeFile(keep, 'keep')
                }

                await nodeWorkspaceFileSystem.writeExclusive(path, text)
            }
        }

        await assert.rejects(service(fs).prepare(context), error('FILE_CHANGED'))
        assert.equal(await readFile(keep, 'utf8'), 'keep')
    })

    it('DB 재검사 실패는 기록과 staging을 보존하고 DB 오류로 반환한다', async () => {
        const { context } = started()
        let count = 0

        const repository = {
            snapshot: workspace.snapshot.bind(workspace),

            assertCurrent(expected: Parameters<DownloadWorkspaceRepository['assertCurrent']>[0]) {
                if (++count === 2) {
                    throw Error('private SQL')
                }

                workspace.assertCurrent(expected)
            }
        }

        const value = new DownloadWorkspaceService(repository, root!)

        await assert.rejects(value.prepare(context), error('DATABASE_ERROR'))
        assert.equal((await json(paths(context).ready)).phase, 'ready')
        assert.deepEqual(await readdir(context.stagingDirectory), [])
    })

    it('다른 서비스 인스턴스의 같은 시도 동시 준비도 차단한다', async () => {
        const { context } = started()
        let entered!: () => void
        let release!: () => void

        const waiting = new Promise<void>((resolve) => {
            entered = resolve
        })
        const wait = new Promise<void>((resolve) => {
            release = resolve
        })

        const fs: WorkspaceFileSystem = {
            ...nodeWorkspaceFileSystem,

            async writeExclusive(path, text) {
                if (JSON.parse(text).phase === 'preparing') {
                    entered()
                    await wait
                }

                await nodeWorkspaceFileSystem.writeExclusive(path, text)
            }
        }

        const running = service(fs).prepare(context)

        await waiting

        try {
            await assert.rejects(service().prepare(context), error('ALREADY_PROCESSING'))
        } finally {
            release()
        }

        await running
    })

    it('준비 직후 중단된 빈 staging을 정리해도 초기 기록은 유지한다', async () => {
        const { context } = started()

        await service().prepare(context)

        const recovery = new DownloadRecoveryRepository(db, root!)

        const decision = recovery.finishAfterEngineExit(
            context.jobId,
            context.attemptId,
            'DOWNLOAD_ENGINE_FAILED'
        )

        assert.equal(decision.status, 'cleanup_required')

        if (decision.status !== 'cleanup_required') {
            throw Error('fixture')
        }

        await new DownloadCleanupService(
            new DownloadCleanupRepository(db, root!),
            root!
        ).runAtStartup(decision.taskId)

        assert.equal(repo.get(context.jobId)!.cleanupRequired, false)
        await assert.rejects(lstat(context.stagingDirectory), { code: 'ENOENT' })
        assert.equal((await json(paths(context).ready)).phase, 'ready')

        const { attempt } = repo.startAttempt(context.jobId, 'manual_retry')

        assert.notEqual(attempt.id, context.attemptId)
    })

    it('Runner에서 실제 준비·검증·저장을 연결해 두 종류의 기록을 함께 유지한다', async () => {
        const { job } = queued()
        const commits = new DownloadCommitRepository(db, root!)

        const runner = new DownloadRunner(
            {
                repository: repo,
                commits,
                recovery: new DownloadRecoveryRepository(db, root!),
                workspace: service(),
                verification: new DownloadVerificationService(repo, root!),
                storage: new DownloadStorageService(commits, root!),

                selectAdapter: () => ({
                    async discover() {
                        return ['a', 'b'].map((targetKey) => ({
                            targetKey,
                            sourceUrl: 'https://example.invalid/' + targetKey,
                            metadata: { kind: 'image' as const }
                        }))
                    },

                    async downloadFrozen(input) {
                        assert.equal((await json(paths(input).ready)).phase, 'ready')

                        const results: DownloadResultInput[] = []

                        for (const target of input.targets) {
                            const path = join(input.stagingDirectory, target.targetKey + '.bin')

                            await writeFile(path, 'abc', { flag: 'wx' })

                            results.push({
                                targetKey: target.targetKey,
                                stagedPath: path
                            })
                        }

                        return results
                    }
                })
            },
            root!
        )

        const result = await runner.run(job.id, 'manual_initial')

        assert.equal(result.status, 'committed')

        const attemptId = repo.get(job.id)!.currentAttemptId!

        const context = {
            jobId: job.id,
            attemptId,
            stagingDirectory: downloadStagingDirectory(root!, job.id, attemptId)
        }

        assert.equal((await json(paths(context).ready)).phase, 'ready')
        assert.equal((await json(paths(context).commit)).phase, 'committed')
        assert.equal(db.select().from(s.mediaFiles).all().length, 2)
    })
})
