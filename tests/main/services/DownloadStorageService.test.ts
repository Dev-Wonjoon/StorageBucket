import assert from 'node:assert/strict'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
    appendFile,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
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
import type { V2Database } from '../../../src/main/repositories/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError
} from '../../../src/main/repositories/DownloadRepository'
import { DownloadCommitRepository } from '../../../src/main/repositories/DownloadCommitRepository'
import {
    DownloadVerificationService,
    downloadStagingDirectory
} from '../../../src/main/services/DownloadVerificationService'
import {
    DownloadStorageService,
    nodeStorageFileSystem,
    type StorageFileSystem
} from '../../../src/main/services/DownloadStorageService'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let commit: DownloadCommitRepository
let root: string | undefined
let tempParent: string
let jobId: string
let attemptId: string

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(async () => {
    root = undefined
    tempParent = await realpath(tmpdir())
    root = await mkdtemp(join(tempParent, 'storagebucket-storage-'))

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    repo = new DownloadRepository(db)
    commit = new DownloadCommitRepository(db, root)
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
            assert.equal(dirname(owned), tempParent)

            assert.ok(basename(owned).startsWith('storagebucket-storage-'))

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

async function ready(replace = false) {
    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/set?token=secret',
            normalizedUrl: 'https://example.invalid/set?token=secret',
            normalizationVersion: 1
        })
        .returning()
        .get()

    let parent: typeof s.medias.$inferSelect | undefined

    if (replace) {
        await writeFile(join(root!, 'old.bin'), 'keep original')

        parent = db
            .insert(s.medias)
            .values({
                sourceKind: 'download',
                requestUrlId: url.id,
                customTitle: 'keep title'
            })
            .returning()
            .get()

        db.insert(s.mediaFiles)
            .values({
                mediaId: parent.id,
                fileKey: 'old',
                position: 0,
                kind: 'image',
                storageKind: 'unverified_legacy',
                filepath: join(root!, 'old.bin')
            })
            .run()
    }

    const job = repo.enqueue(
        parent
            ? {
                  requestUrlId: url.id,
                  originalUrl: url.url,
                  mode: 'replace',
                  mediaId: parent.id,
                  expectedRevision: parent.revision
              }
            : {
                  requestUrlId: url.id,
                  originalUrl: url.url,
                  mode: 'create'
              }
    )

    const { attempt } = repo.startAttempt(job.id, 'manual_initial')

    jobId = job.id
    attemptId = attempt.id

    const staging = downloadStagingDirectory(root!, jobId, attemptId)

    await mkdir(staging, { recursive: true })

    repo.freezeTargets(
        jobId,
        attemptId,
        ['a', 'b'].map((targetKey) => ({
            targetKey,
            sourceUrl: url.url + '&item=' + targetKey,
            metadata: {
                kind: 'image',
                title: 'secret metadata'
            }
        }))
    )

    const paths = ['a', 'b'].map((key) => join(staging, key + '.png'))

    await writeFile(paths[0], 'abc')
    await writeFile(paths[1], 'def')

    repo.recordResults(
        jobId,
        attemptId,
        paths.map((stagedPath, index) => ({
            targetKey: index === 0 ? 'a' : 'b',
            stagedPath
        }))
    )

    await new DownloadVerificationService(repo, root!).verify(jobId, attemptId)

    return commit.prepare(jobId, attemptId)
}

function service(
    fs: StorageFileSystem = nodeStorageFileSystem,
    repository: Pick<DownloadCommitRepository, 'prepare' | 'begin' | 'complete'> = commit
) {
    return new DownloadStorageService(repository, root!, fs)
}

const run = (value = service(), signal?: AbortSignal) => value.finalize(jobId, attemptId, signal)

async function journal(path: string) {
    return JSON.parse(await readFile(path, 'utf8'))
}

function holding() {
    assert.equal(repo.get(jobId)!.state, 'running')

    const row = db
        .select()
        .from(s.downloadAttempts)
        .where(eq(s.downloadAttempts.id, attemptId))
        .get()!

    assert.equal(row.phase, 'committing')
    assert.equal(row.committedAt, null)
}

function failPhase(phase: string): StorageFileSystem {
    return {
        ...nodeStorageFileSystem,

        async writeExclusive(path, content) {
            if (JSON.parse(content).phase === phase) {
                throw fault()
            }

            await nodeStorageFileSystem.writeExclusive(path, content)
        }
    }
}

describe('DownloadStorageService', () => {
    it('배타적으로 저장하고 최종 파일을 재검사한 뒤 전체 DB를 완료한다', async () => {
        const plan = await ready()
        const result = await run()

        assert.equal(result.manifestFinalized, true)
        assert.equal(repo.get(jobId)!.state, 'completed')
        assert.equal(db.select().from(s.mediaFiles).all().length, 2)

        for (const [index, target] of plan.targets.entries()) {
            assert.equal(await readFile(target.finalPath, 'utf8'), index === 0 ? 'abc' : 'def')

            assert.equal((await lstat(target.finalPath, { bigint: true })).nlink, 1n)

            await assert.rejects(lstat(target.stagedPath), { code: 'ENOENT' })
        }

        const text = await readFile(plan.manifestPath, 'utf8')

        assert.ok(!text.includes('secret'))
        assert.ok(!text.includes('https://'))

        const saved = JSON.parse(text)

        assert.equal(saved.phase, 'committed')
        assert.deepEqual(
            saved.completedTargetIds,
            plan.targets.map((target) => target.id)
        )
        assert.equal(saved.result.mediaId, result.mediaId)
    })

    it('재다운로드해도 소유 미확인 원본은 읽기 전용 목록으로 보존한다', async () => {
        const plan = await ready(true)

        await run()

        assert.equal(await readFile(join(root!, 'old.bin'), 'utf8'), 'keep original')
        assert.equal(db.select().from(s.medias).get()!.customTitle, 'keep title')

        const saved = await journal(plan.manifestPath)

        assert.equal(saved.oldFiles[0].storageKind, 'unverified_legacy')
    })

    it('기존 manifest를 덮어쓰거나 저장 단계를 시작하지 않는다', async () => {
        const plan = await ready()

        await mkdir(dirname(plan.manifestPath), { recursive: true })
        await writeFile(plan.manifestPath, 'existing journal')

        await assert.rejects(run(), error('MANIFEST_EXISTS'))

        assert.equal(await readFile(plan.manifestPath, 'utf8'), 'existing journal')
        assert.equal(db.select().from(s.downloadAttempts).get()!.phase, 'verifying')
        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')
    })

    it('첫 manifest 기록 실패는 begin과 파일 이동을 실행하지 않는다', async () => {
        const plan = await ready()

        await assert.rejects(run(service(failPhase('prepared'))), error('FILE_IO_ERROR'))

        assert.equal(db.select().from(s.downloadAttempts).get()!.phase, 'verifying')
        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')
    })

    it('DB 조회 실패는 파일 오류로 바꾸지 않고 파일 작업 전에 중단한다', async () => {
        const plan = await ready()

        const repository = {
            prepare() {
                throw fault()
            },
            begin: commit.begin.bind(commit),
            complete: commit.complete.bind(commit)
        }

        await assert.rejects(
            run(service(nodeStorageFileSystem, repository)),
            error('DATABASE_ERROR')
        )

        await assert.rejects(lstat(plan.manifestPath), { code: 'ENOENT' })
    })

    it('begin 응답 유실은 manifest와 staging을 보존하고 이동을 시작하지 않는다', async () => {
        const plan = await ready()

        const repository = {
            prepare: commit.prepare.bind(commit),
            complete: commit.complete.bind(commit),

            begin(...args: Parameters<DownloadCommitRepository['begin']>) {
                commit.begin(...args)
                throw fault()
            }
        }

        await assert.rejects(
            run(service(nodeStorageFileSystem, repository)),
            error('DATABASE_ERROR')
        )

        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')

        await assert.rejects(lstat(plan.targets[0].finalPath), { code: 'ENOENT' })

        assert.equal((await journal(plan.manifestPath)).phase, 'prepared')

        holding()
    })

    it('목적지 충돌은 기존 파일과 staging을 보존한다', async () => {
        const plan = await ready()
        const first = plan.targets[0]

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async link(from, to) {
                if (to === first.finalPath) {
                    await writeFile(to, 'existing destination', { flag: 'wx' })
                }

                await nodeStorageFileSystem.link(from, to)
            }
        }

        await assert.rejects(run(service(fs)), error('TARGET_PATH_COLLISION'))

        assert.equal(await readFile(first.finalPath, 'utf8'), 'existing destination')
        assert.equal(await readFile(first.stagedPath, 'utf8'), 'abc')

        holding()
    })

    it('시도별 최종 디렉터리가 이미 있으면 재사용하지 않는다', async () => {
        const plan = await ready()

        await mkdir(dirname(plan.targets[0].finalPath), { recursive: true })

        await assert.rejects(run(), error('TARGET_PATH_COLLISION'))

        holding()

        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')
    })

    it('link 의도 기록 실패 후에는 원본 이름을 변경하지 않는다', async () => {
        const plan = await ready()

        await assert.rejects(run(service(failPhase('link_intent'))), error('FILE_IO_ERROR'))

        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')

        await assert.rejects(lstat(plan.targets[0].finalPath), { code: 'ENOENT' })

        holding()
    })

    it('link 직후 기록 실패는 두 경로를 보존하고 완료하지 않는다', async () => {
        const plan = await ready()

        await assert.rejects(run(service(failPhase('unlink_intent'))), error('FILE_IO_ERROR'))

        const target = plan.targets[0]

        assert.equal(await readFile(target.finalPath, 'utf8'), 'abc')
        assert.equal(await readFile(target.stagedPath, 'utf8'), 'abc')
        assert.equal((await lstat(target.finalPath, { bigint: true })).nlink, 2n)
        assert.equal((await journal(plan.manifestPath)).phase, 'link_intent')

        holding()
    })

    it('staging 이름 제거 실패도 두 경로와 복구 의도를 보존한다', async () => {
        const plan = await ready()

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async unlink(path) {
                if (path === plan.targets[0].stagedPath) {
                    throw fault()
                }

                await nodeStorageFileSystem.unlink(path)
            }
        }

        await assert.rejects(run(service(fs)), error('FILE_IO_ERROR'))

        assert.equal((await journal(plan.manifestPath)).phase, 'unlink_intent')
        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')
        assert.equal(await readFile(plan.targets[0].finalPath, 'utf8'), 'abc')

        holding()
    })

    it('두 번째 파일 실패는 첫 파일만 DB에 등록하지 않는다', async () => {
        const plan = await ready()

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async link(from, to) {
                if (to === plan.targets[1].finalPath) {
                    throw fault()
                }

                await nodeStorageFileSystem.link(from, to)
            }
        }

        await assert.rejects(run(service(fs)), error('FILE_IO_ERROR'))

        assert.equal(db.select().from(s.mediaFiles).all().length, 0)
        assert.equal(await readFile(plan.targets[0].finalPath, 'utf8'), 'abc')
        assert.equal(await readFile(plan.targets[1].stagedPath, 'utf8'), 'def')

        holding()
    })

    it('DB 완료 호출 실패는 최종 파일과 이전 등록을 보존한다', async () => {
        const plan = await ready(true)

        const repository = {
            prepare: commit.prepare.bind(commit),
            begin: commit.begin.bind(commit),

            complete() {
                throw fault()
            }
        }

        await assert.rejects(
            run(service(nodeStorageFileSystem, repository)),
            error('COMMIT_STATE_UNKNOWN')
        )

        assert.equal(await readFile(plan.targets[0].finalPath, 'utf8'), 'abc')
        assert.equal(db.select().from(s.mediaFiles).get()!.fileKey, 'old')
        assert.equal((await journal(plan.manifestPath)).phase, 'db_commit_intent')

        holding()
    })

    it('커밋 성공 후 응답만 유실돼도 파일을 삭제하지 않는다', async () => {
        const plan = await ready()

        const repository = {
            prepare: commit.prepare.bind(commit),
            begin: commit.begin.bind(commit),

            complete(...args: Parameters<DownloadCommitRepository['complete']>) {
                commit.complete(...args)
                throw fault()
            }
        }

        await assert.rejects(
            run(service(nodeStorageFileSystem, repository)),
            error('COMMIT_STATE_UNKNOWN')
        )

        assert.equal(repo.get(jobId)!.state, 'completed')

        assert.equal(db.select().from(s.medias).get()!.lastDownloadCommitAttemptId, attemptId)

        assert.equal(await readFile(plan.targets[0].finalPath, 'utf8'), 'abc')
    })

    it('DB 완료 뒤 manifest 보완 실패는 완료 결과로 반환한다', async () => {
        const plan = await ready()

        const result = await run(service(failPhase('committed')))

        assert.equal(result.manifestFinalized, false)
        assert.equal(repo.get(jobId)!.state, 'completed')
        assert.equal((await journal(plan.manifestPath)).phase, 'db_commit_intent')
        assert.equal(await readFile(plan.targets[1].finalPath, 'utf8'), 'def')
    })

    it('검증 후 staging 내용이 바뀌면 manifest와 파일 이동 전에 거절한다', async () => {
        const plan = await ready()

        await appendFile(plan.targets[0].stagedPath, 'changed')

        await assert.rejects(run(), error('FILE_CHANGED'))

        assert.equal(db.select().from(s.downloadAttempts).get()!.phase, 'verifying')

        await assert.rejects(lstat(plan.manifestPath), { code: 'ENOENT' })
    })

    it('나중 파일 처리 중 먼저 옮긴 파일이 바뀌면 DB 완료 직전 다시 거절한다', async () => {
        const plan = await ready()

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async writeExclusive(path, content) {
                if (JSON.parse(content).phase === 'db_commit_intent') {
                    await appendFile(plan.targets[0].finalPath, 'changed')
                }

                await nodeStorageFileSystem.writeExclusive(path, content)
            }
        }

        await assert.rejects(run(service(fs)), error('FILE_CHANGED'))

        assert.equal(db.select().from(s.medias).all().length, 0)

        holding()
    })

    it('최종 저장소의 정션을 따라가 외부 폴더에 쓰지 않는다', async () => {
        await ready()

        const outside = join(root!, 'outside')
        await mkdir(outside)

        const files = join(root!, '.storagebucket', 'files')

        await symlink(outside, files, process.platform === 'win32' ? 'junction' : 'dir')

        await assert.rejects(run(), error('UNSAFE_STAGING_PATH'))

        holding()
    })

    it('시작 전 취소는 파일 작업을 하지 않는다', async () => {
        const plan = await ready()
        const controller = new AbortController()

        controller.abort()

        await assert.rejects(run(service(), controller.signal), error('CANCEL_REQUESTED'))

        await assert.rejects(lstat(plan.manifestPath), { code: 'ENOENT' })
    })

    it('committing 진입 뒤 AbortSignal은 이미 시작한 커밋을 취소하지 않는다', async () => {
        const plan = await ready()
        const controller = new AbortController()

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async link(from, to) {
                await nodeStorageFileSystem.link(from, to)

                if (to === plan.targets[0].finalPath) {
                    controller.abort()
                }
            }
        }

        await run(service(fs), controller.signal)

        assert.equal(repo.get(jobId)!.state, 'completed')
    })

    it('서로 다른 서비스 인스턴스의 같은 시도 동시 저장도 차단한다', async () => {
        await ready()

        let entered!: () => void
        let release!: () => void

        const waiting = new Promise<void>((resolve) => {
            entered = resolve
        })

        const barrier = new Promise<void>((resolve) => {
            release = resolve
        })

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async writeExclusive(path, content) {
                if (JSON.parse(content).phase === 'prepared') {
                    entered()
                    await barrier
                }

                await nodeStorageFileSystem.writeExclusive(path, content)
            }
        }

        const first = run(service(fs))

        await waiting

        try {
            await assert.rejects(run(service()), error('ALREADY_PROCESSING'))
        } finally {
            release()
        }

        await first

        assert.equal(repo.get(jobId)!.state, 'completed')
    })

    it('manifest가 교체되면 덮어쓰거나 staging을 제거하지 않는다', async () => {
        const plan = await ready()

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async writeExclusive(path, content) {
                if (JSON.parse(content).phase === 'unlink_intent') {
                    await writeFile(plan.manifestPath, 'foreign record')
                }

                await nodeStorageFileSystem.writeExclusive(path, content)
            }
        }

        await assert.rejects(run(service(fs)), error('FILE_CHANGED'))

        assert.equal(await readFile(plan.manifestPath, 'utf8'), 'foreign record')
        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')

        holding()
    })

    it('hard link 미지원 오류에 일반 rename으로 우회하지 않는다', async () => {
        const plan = await ready()

        const fs: StorageFileSystem = {
            ...nodeStorageFileSystem,

            async link(from, to) {
                if (to === plan.targets[0].finalPath) {
                    throw fault()
                }

                await nodeStorageFileSystem.link(from, to)
            }
        }

        await assert.rejects(run(service(fs)), error('FILE_IO_ERROR'))

        assert.equal(await readFile(plan.targets[0].stagedPath, 'utf8'), 'abc')

        await assert.rejects(lstat(plan.targets[0].finalPath), { code: 'ENOENT' })
    })
})
