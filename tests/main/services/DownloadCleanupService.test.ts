import assert from 'node:assert/strict'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
    appendFile,
    link,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rename,
    rm,
    symlink,
    unlink,
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
import { DownloadRecoveryRepository } from '../../../src/main/repositories/DownloadRecoveryRepository'
import { DownloadCleanupRepository } from '../../../src/main/repositories/DownloadCleanupRepository'
import {
    DownloadVerificationService,
    downloadStagingDirectory
} from '../../../src/main/services/DownloadVerificationService'
import {
    DownloadCleanupService,
    nodeCleanupFileSystem,
    type CleanupFileSystem
} from '../../../src/main/services/DownloadCleanupService'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let recovery: DownloadRecoveryRepository
let cleanup: DownloadCleanupRepository
let root: string | undefined
let tempParent: string
let serial: number

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(async () => {
    root = undefined
    tempParent = await realpath(tmpdir())
    root = await mkdtemp(join(tempParent, 'storagebucket-cleanup-'))

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    repo = new DownloadRepository(db)
    recovery = new DownloadRecoveryRepository(db, root)
    cleanup = new DownloadCleanupRepository(db, root)
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
            assert.equal(dirname(owned), tempParent)
            assert.ok(basename(owned).startsWith('storagebucket-cleanup-'))

            await rm(owned, {
                recursive: true,
                force: true
            })
        }
    }
})

const error = (code: string) => (value: unknown) =>
    value instanceof DownloadRepositoryError && value.code === code

const fault = () => Object.assign(new Error('private path'), { code: 'EIO' })

function service(fs: CleanupFileSystem = nodeCleanupFileSystem) {
    return new DownloadCleanupService(cleanup, root!, fs)
}

function task(id: string) {
    return db.select().from(s.maintenanceTasks).where(eq(s.maintenanceTasks.id, id)).get()!
}

async function ready(mode: 'staged' | 'final' | 'pair' | 'empty' | 'unverified' = 'staged') {
    const url = 'https://example.invalid/' + ++serial

    const request = db
        .insert(s.downloadUrls)
        .values({
            url,
            normalizedUrl: url,
            normalizationVersion: 1
        })
        .returning()
        .get()

    const parent = db
        .insert(s.medias)
        .values({
            sourceKind: 'download',
            requestUrlId: request.id,
            customTitle: 'keep title'
        })
        .returning()
        .get()

    const oldPath = join(root!, 'old-' + serial + '.bin')

    await writeFile(oldPath, 'keep original')

    const old = db
        .insert(s.mediaFiles)
        .values({
            mediaId: parent.id,
            fileKey: 'old',
            position: 0,
            kind: 'image',
            storageKind: 'unverified_legacy',
            filepath: oldPath
        })
        .returning()
        .get()

    const job = repo.enqueue({
        requestUrlId: request.id,
        originalUrl: url,
        mode: 'replace',
        mediaId: parent.id,
        expectedRevision: parent.revision
    })

    const { attempt } = repo.startAttempt(job.id, 'manual_initial')

    const staging = downloadStagingDirectory(root!, job.id, attempt.id)

    await mkdir(staging, { recursive: true })

    repo.freezeTargets(
        job.id,
        attempt.id,
        ['a', 'b'].map((targetKey) => ({
            targetKey,
            sourceUrl: url + '/' + targetKey,
            metadata: { kind: 'image' }
        }))
    )

    const paths = ['a', 'b'].map((key) => join(staging, key + '.bin'))

    for (const path of paths) {
        await writeFile(path, 'abc')
    }

    repo.recordResults(
        job.id,
        attempt.id,
        paths.map((stagedPath, index) => ({
            targetKey: index === 0 ? 'a' : 'b',
            stagedPath
        }))
    )

    if (mode !== 'unverified') {
        await new DownloadVerificationService(repo, root!).verify(job.id, attempt.id)
    }

    const committer = new DownloadCommitRepository(db, root!)

    const plan = mode === 'unverified' ? null : committer.prepare(job.id, attempt.id)

    if (mode === 'final' || mode === 'pair') {
        committer.begin(plan!)

        await mkdir(dirname(plan!.targets[0].finalPath), { recursive: true })

        for (const target of plan!.targets) {
            if (mode === 'pair') {
                await link(target.stagedPath, target.finalPath)
            } else {
                await rename(target.stagedPath, target.finalPath)
            }
        }
    }

    if (mode === 'empty') {
        for (const path of paths) {
            await unlink(path)
        }
    }

    const decision = recovery.recoverAtStartup(job.id)

    assert.equal(decision.status, 'cleanup_required')

    if (decision.status !== 'cleanup_required') {
        throw Error('fixture')
    }

    return {
        taskId: decision.taskId,
        jobId: job.id,
        attemptId: attempt.id,
        paths,
        staging,
        old,
        plan
    }
}

function held(value: Awaited<ReturnType<typeof ready>>) {
    assert.equal(repo.get(value.jobId)!.cleanupRequired, true)
    assert.notEqual(task(value.taskId).state, 'completed')
}

describe('DownloadCleanupService', () => {
    it('검증된 staging 결과만 지우고 원본·제목·중단 상태를 유지한다', async () => {
        const value = await ready()

        await service().runAtStartup(value.taskId)

        for (const path of value.paths) {
            await assert.rejects(lstat(path), { code: 'ENOENT' })
        }

        assert.equal(await readFile(value.old.filepath, 'utf8'), 'keep original')
        assert.equal(db.select().from(s.medias).get()!.customTitle, 'keep title')
        assert.equal(repo.get(value.jobId)!.state, 'interrupted')
        assert.equal(repo.get(value.jobId)!.cleanupRequired, false)
        assert.equal(task(value.taskId).state, 'completed')

        repo.startAttempt(value.jobId, 'manual_restart')

        assert.equal(db.select().from(s.downloadAttempts).all().length, 2)
    })

    it('최종 경로로 이동된 미반영 결과도 정리하며 manifest는 보존한다', async () => {
        const value = await ready('final')

        await mkdir(dirname(value.plan!.manifestPath), { recursive: true })

        await writeFile(value.plan!.manifestPath, 'untrusted journal stays')

        await service().runAtStartup(value.taskId)

        for (const target of value.plan!.targets) {
            await assert.rejects(lstat(target.finalPath), { code: 'ENOENT' })
        }

        assert.equal(await readFile(value.plan!.manifestPath, 'utf8'), 'untrusted journal stays')
    })

    it('staging과 final에 남은 동일 파일의 두 링크를 안전하게 제거한다', async () => {
        const value = await ready('pair')

        assert.equal((await lstat(value.paths[0], { bigint: true })).nlink, 2n)

        await service().runAtStartup(value.taskId)

        for (const target of value.plan!.targets) {
            await assert.rejects(lstat(target.stagedPath), { code: 'ENOENT' })
            await assert.rejects(lstat(target.finalPath), { code: 'ENOENT' })
        }

        assert.equal(repo.get(value.jobId)!.cleanupRequired, false)
    })

    it('이미 파일이 없는 시도는 빈 디렉터리 확인 후 정리를 완료한다', async () => {
        const value = await ready('empty')

        await service().runAtStartup(value.taskId)

        assert.equal(task(value.taskId).state, 'completed')
    })

    it('검증 증명이 없는 부분 파일은 자동 삭제하지 않는다', async () => {
        const value = await ready('unverified')

        await assert.rejects(service().runAtStartup(value.taskId), error('CLEANUP_REQUIRED'))

        assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')

        held(value)
    })

    it('예상 밖 파일이 하나라도 있으면 삭제를 시작하지 않는다', async () => {
        const value = await ready()
        const extra = join(value.staging, 'unknown.part')

        await writeFile(extra, 'keep')

        await assert.rejects(service().runAtStartup(value.taskId), error('CLEANUP_REQUIRED'))

        assert.equal(await readFile(extra, 'utf8'), 'keep')
        assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')

        held(value)
    })

    it('중간 정션을 따라가 외부 원본을 삭제하지 않는다', async () => {
        const value = await ready()
        const outside = join(root!, 'outside')

        await mkdir(outside)
        await writeFile(join(outside, 'original'), 'keep')

        await symlink(
            outside,
            join(value.staging, 'alias'),
            process.platform === 'win32' ? 'junction' : 'dir'
        )

        await assert.rejects(service().runAtStartup(value.taskId), error('UNSAFE_STAGING_PATH'))

        assert.equal(await readFile(join(outside, 'original'), 'utf8'), 'keep')

        held(value)
    })

    it('알려진 두 경로 외에 추가 하드 링크가 있으면 보존한다', async () => {
        const value = await ready()
        const outside = join(root!, 'outside-link')

        await link(value.paths[0], outside)

        await assert.rejects(service().runAtStartup(value.taskId), error('FILE_CHANGED'))

        assert.equal(await readFile(outside, 'utf8'), 'abc')
        assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')

        held(value)
    })

    it('내용 변경과 같은 내용의 파일 교체도 소유 파일로 인정하지 않는다', async () => {
        const changed = await ready()

        await appendFile(changed.paths[0], 'changed')

        await assert.rejects(service().runAtStartup(changed.taskId), error('FILE_CHANGED'))

        const replaced = await ready()

        await rename(replaced.paths[0], join(root!, 'saved-original'))
        await writeFile(replaced.paths[0], 'abc')

        await assert.rejects(service().runAtStartup(replaced.taskId), error('FILE_CHANGED'))

        held(changed)
        held(replaced)
    })

    it('원본·썸네일·미리보기의 남은 참조가 있으면 삭제하지 않는다', async () => {
        for (const role of ['original', 'thumbnail', 'preview']) {
            const value = await ready()

            db.update(s.mediaFiles)
                .set(
                    role === 'original'
                        ? { filepath: value.paths[0] }
                        : role === 'thumbnail'
                          ? {
                                thumbnailPath: value.paths[0],
                                thumbnailOrigin: 'unverified_legacy'
                            }
                          : {
                                previewPath: value.paths[0]
                            }
                )
                .where(eq(s.mediaFiles.id, value.old.id))
                .run()

            await assert.rejects(service().runAtStartup(value.taskId), error('CLEANUP_REQUIRED'))

            assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')

            held(value)
        }
    })

    it('정션 별칭을 통한 DB 참조도 같은 파일로 확인해 보호한다', async () => {
        const value = await ready()
        const alias = join(root!, 'reference-alias')

        await symlink(value.staging, alias, process.platform === 'win32' ? 'junction' : 'dir')

        db.update(s.mediaFiles)
            .set({
                filepath: join(alias, basename(value.paths[0]))
            })
            .where(eq(s.mediaFiles.id, value.old.id))
            .run()

        await assert.rejects(service().runAtStartup(value.taskId), error('CLEANUP_REQUIRED'))

        assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')
    })

    it('참조 경로의 접근 실패도 무시하지 않는다', async () => {
        const value = await ready()

        const fs: CleanupFileSystem = {
            ...nodeCleanupFileSystem,

            async realpath(path) {
                if (path === value.old.filepath) {
                    throw fault()
                }

                return nodeCleanupFileSystem.realpath(path)
            }
        }

        await assert.rejects(service(fs).runAtStartup(value.taskId), error('FILE_IO_ERROR'))

        assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')

        held(value)
    })

    it('두 번째 삭제 실패 뒤 재실행해도 이미 지운 파일은 오류로 취급하지 않는다', async () => {
        const value = await ready()
        let count = 0

        const fs: CleanupFileSystem = {
            ...nodeCleanupFileSystem,

            async unlink(path) {
                if (++count === 2) throw fault()
                await nodeCleanupFileSystem.unlink(path)
            }
        }

        await assert.rejects(service(fs).runAtStartup(value.taskId), error('FILE_IO_ERROR'))

        assert.equal(task(value.taskId).state, 'failed')

        held(value)

        await service().runAtStartup(value.taskId)

        assert.equal(task(value.taskId).tryCount, 2)
        assert.equal(repo.get(value.jobId)!.cleanupRequired, false)
    })

    it('차단 해제 DB 트랜잭션 실패는 완료 기록도 롤백한다', async () => {
        const value = await ready()

        sqlite.exec(`
            CREATE TRIGGER fail_release
            BEFORE UPDATE OF cleanup_required ON download_queue
            WHEN NEW.cleanup_required = 0
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        await assert.rejects(service().runAtStartup(value.taskId), error('COMMIT_STATE_UNKNOWN'))

        held(value)

        assert.equal(task(value.taskId).state, 'running')

        sqlite.exec('DROP TRIGGER fail_release')

        await service().runAtStartup(value.taskId)

        assert.equal(repo.get(value.jobId)!.cleanupRequired, false)
    })

    it('완료 뒤 재호출은 새 시도의 차단 상태나 파일을 변경하지 않는다', async () => {
        const value = await ready()

        await service().runAtStartup(value.taskId)

        repo.startAttempt(value.jobId, 'manual_restart')

        const next = recovery.recoverAtStartup(value.jobId)

        assert.equal(next.status, 'cleanup_required')

        const result = await service().runAtStartup(value.taskId)

        assert.equal(result.alreadyCompleted, true)
        assert.equal(repo.get(value.jobId)!.cleanupRequired, true)
    })

    it('변조한 정리 경로는 파일을 조회하거나 삭제하기 전에 거절한다', async () => {
        const value = await ready()

        const payload = JSON.parse(task(value.taskId).payloadJson)

        payload.stagingDirectory = root

        db.update(s.maintenanceTasks)
            .set({
                payloadJson: JSON.stringify(payload)
            })
            .where(eq(s.maintenanceTasks.id, value.taskId))
            .run()

        await assert.rejects(service().runAtStartup(value.taskId), error('VERIFICATION_CHANGED'))

        assert.equal(await readFile(value.paths[0], 'utf8'), 'abc')
    })

    it('rmdir 직전 새 파일이 생기면 재귀 삭제 없이 보존한다', async () => {
        const value = await ready()
        const extra = join(value.staging, 'new-file')

        const fs: CleanupFileSystem = {
            ...nodeCleanupFileSystem,

            async rmdir(path) {
                if (path === value.staging) {
                    await writeFile(extra, 'keep')
                }

                await nodeCleanupFileSystem.rmdir(path)
            }
        }

        await assert.rejects(service(fs).runAtStartup(value.taskId), error('FILE_IO_ERROR'))

        assert.equal(await readFile(extra, 'utf8'), 'keep')

        held(value)
    })
})
