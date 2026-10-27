import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
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
    DownloadRepositoryError
} from '@features/download/DownloadRepository'
import { DownloadCommitRepository } from '@features/download/DownloadCommitRepository'
import { DownloadRecoveryRepository } from '@features/download/DownloadRecoveryRepository'
import { downloadStagingDirectory } from '@features/download/DownloadVerificationService'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let commit: DownloadCommitRepository
let recovery: DownloadRecoveryRepository
let now: number
let serial: number

const root = resolve('fixture-storage')

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    now = 1_800_000_000_000
    serial = 0

    repo = new DownloadRepository(db, () => now)
    commit = new DownloadCommitRepository(db, root, () => now)
    recovery = new DownloadRecoveryRepository(db, root, () => now)
})

afterEach(() => {
    if (!sqlite?.open) return

    try {
        assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
    } finally {
        sqlite.close()
    }
})

const error = (code: string) => (value: unknown) =>
    value instanceof DownloadRepositoryError && value.code === code

function queued(replace = false) {
    const url = 'https://example.invalid/set/' + ++serial + '?secret=keep-private'

    const request = db
        .insert(s.downloadUrls)
        .values({
            url,
            normalizedUrl: url,
            normalizationVersion: 1
        })
        .returning()
        .get()

    const parent = replace
        ? db
              .insert(s.medias)
              .values({
                  sourceKind: 'download',
                  requestUrlId: request.id,
                  customTitle: 'keep title',
                  revision: 3
              })
              .returning()
              .get()
        : undefined

    if (parent) {
        db.insert(s.mediaFiles)
            .values({
                mediaId: parent.id,
                fileKey: 'old',
                position: 0,
                kind: 'image',
                filepath: join(root, 'old.png'),
                storageKind: 'unverified_legacy'
            })
            .run()
    }

    const job = repo.enqueue(
        parent
            ? {
                  requestUrlId: request.id,
                  originalUrl: url,
                  mode: 'replace',
                  mediaId: parent.id,
                  expectedRevision: parent.revision
              }
            : {
                  requestUrlId: request.id,
                  originalUrl: url,
                  mode: 'create'
              }
    )

    return {
        jobId: job.id,
        request,
        parent
    }
}

function started(replace = false) {
    const value = queued(replace)

    const { attempt } = repo.startAttempt(value.jobId, 'manual_initial')

    return {
        ...value,
        attemptId: attempt.id
    }
}

function verify(value: { jobId: string; attemptId: string }) {
    const { jobId, attemptId } = value

    repo.freezeTargets(
        jobId,
        attemptId,
        ['a', 'b'].map((targetKey) => ({
            targetKey,
            sourceUrl: 'https://example.invalid/' + targetKey,
            metadata: {
                kind: 'image',
                title: 'private metadata'
            }
        }))
    )

    const staging = downloadStagingDirectory(root, jobId, attemptId)

    repo.recordResults(
        jobId,
        attemptId,
        ['a', 'b'].map((targetKey) => ({
            targetKey,
            stagedPath: join(staging, targetKey + '.png')
        }))
    )

    const snapshot = repo.verificationSnapshot(jobId, attemptId)

    repo.markVerified(
        snapshot,
        snapshot.targets.map((target, index) => ({
            targetId: target.id,
            stagedPath: target.stagedPath,
            realPath: target.stagedPath,
            size: 3,
            mtimeNs: '1',
            ctimeNs: '2',
            device: '1',
            inode: String(index + 1),
            sha256: 'a'.repeat(64)
        }))
    )
}

function finish(value: { jobId: string; attemptId: string }) {
    verify(value)

    const plan = commit.prepare(value.jobId, value.attemptId)

    commit.begin(plan)

    const result = commit.complete(
        plan,
        plan.targets.map((target) => {
            const proof = JSON.parse(target.metadataJson).fileVerification

            return {
                ...proof,
                finalPath: target.finalPath,
                realPath: target.finalPath
            }
        })
    )

    return {
        ...value,
        ...result
    }
}

function attempt(id: string) {
    return db.select().from(s.downloadAttempts).where(eq(s.downloadAttempts.id, id)).get()!
}

function tasks() {
    return db.select().from(s.maintenanceTasks).all()
}

function blocked(jobId: string, reason: string) {
    assert.deepEqual(recovery.recoverAtStartup(jobId), {
        status: 'blocked',
        jobId,
        reason
    })
}

describe('DownloadRecoveryRepository', () => {
    it('아직 시작하지 않은 pending 작업을 실행하거나 변경하지 않는다', () => {
        const value = queued()

        const expected = {
            status: 'idle',
            jobId: value.jobId
        }

        assert.deepEqual(recovery.inspect(value.jobId), expected)
        assert.deepEqual(recovery.recoverAtStartup(value.jobId), expected)
        assert.equal(repo.get(value.jobId)!.state, 'pending')
        assert.equal(db.select().from(s.downloadAttempts).all().length, 0)
    })

    it('v2 시도가 없는 이관된 완료·중단 큐는 그대로 둔다', () => {
        for (const state of ['completed', 'interrupted', 'failed', 'cancelled'] as const) {
            const value = queued()

            db.update(s.downloadQueue)
                .set({ state })
                .where(eq(s.downloadQueue.id, value.jobId))
                .run()

            assert.deepEqual(recovery.recoverAtStartup(value.jobId), {
                status: 'settled',
                jobId: value.jobId
            })

            assert.equal(repo.get(value.jobId)!.state, state)
        }

        assert.equal(tasks().length, 0)
    })

    it('조회 판정 자체는 실행 중 작업을 변경하지 않는다', () => {
        const value = started()

        assert.deepEqual(recovery.inspect(value.jobId), {
            status: 'uncommitted',
            jobId: value.jobId,
            attemptId: value.attemptId,
            outcome: 'interrupted'
        })

        assert.equal(repo.get(value.jobId)!.state, 'running')
        assert.equal(tasks().length, 0)
    })

    it('대상 기록 전 중단도 파일 정리 확인이 끝날 때까지 재실행을 막는다', () => {
        const value = started()
        const result = recovery.recoverAtStartup(value.jobId)

        assert.equal(result.status, 'cleanup_required')
        assert.equal(repo.get(value.jobId)!.state, 'interrupted')
        assert.equal(repo.get(value.jobId)!.cleanupRequired, true)
        assert.equal(attempt(value.attemptId).outcome, 'interrupted')
        assert.equal(attempt(value.attemptId).phase, 'finished')
        assert.equal(attempt(value.attemptId).committedAt, null)

        assert.throws(
            () => repo.startAttempt(value.jobId, 'manual_restart'),
            error('CLEANUP_REQUIRED')
        )

        assert.equal(tasks().length, 1)
    })

    it('정리 기록은 시도 소유 경로만 기록하고 URL·원문 메타데이터를 복사하지 않는다', () => {
        const value = started(true)
        verify(value)

        const parentBefore = db.select().from(s.medias).get()
        const filesBefore = db.select().from(s.mediaFiles).all()

        recovery.recoverAtStartup(value.jobId)

        const task = tasks()[0]
        const payload = JSON.parse(task.payloadJson)

        assert.equal(task.kind, 'rollback_cleanup')
        assert.equal(task.ownerKind, 'download')
        assert.equal(task.downloadAttemptId, value.attemptId)
        assert.equal(
            payload.stagingDirectory,
            downloadStagingDirectory(root, value.jobId, value.attemptId)
        )
        assert.equal(payload.attemptId, value.attemptId)

        assert.ok(!task.payloadJson.includes('secret'))
        assert.ok(!task.payloadJson.includes('private metadata'))
        assert.ok(!task.payloadJson.includes('old.png'))

        assert.deepEqual(db.select().from(s.medias).get(), parentBefore)
        assert.deepEqual(db.select().from(s.mediaFiles).all(), filesBefore)
    })

    it('취소 시각 0도 취소로 분류하고 취소·정리 예약을 함께 남긴다', () => {
        const value = started()

        db.update(s.downloadAttempts)
            .set({ cancelRequestedAt: 0 })
            .where(eq(s.downloadAttempts.id, value.attemptId))
            .run()

        recovery.recoverAtStartup(value.jobId)

        assert.equal(repo.get(value.jobId)!.state, 'cancelled')
        assert.equal(attempt(value.attemptId).outcome, 'cancelled')
        assert.equal(attempt(value.attemptId).cancelRequestedAt, 0)
        assert.equal(tasks()[0].kind, 'rollback_cleanup')
    })

    it('이미 예약한 정리 작업을 중복 생성하지 않는다', () => {
        const value = started()

        const first = recovery.recoverAtStartup(value.jobId)

        now++

        assert.deepEqual(recovery.recoverAtStartup(value.jobId), first)
        assert.deepEqual(recovery.inspect(value.jobId), first)
        assert.equal(tasks().length, 1)
    })

    it('정리 실행이 실패했어도 정리 필요를 유지하고 다시 다운로드하지 않는다', () => {
        const value = started()
        const first = recovery.recoverAtStartup(value.jobId)

        db.update(s.maintenanceTasks)
            .set({
                state: 'failed',
                lastError: 'fixture'
            })
            .run()

        assert.deepEqual(recovery.recoverAtStartup(value.jobId), first)
        assert.equal(repo.get(value.jobId)!.cleanupRequired, true)
        assert.equal(db.select().from(s.downloadAttempts).all().length, 1)
    })

    it('committing에서 중단돼도 DB 미반영이면 정리 예약만 한다', () => {
        const value = started()

        verify(value)

        const plan = commit.prepare(value.jobId, value.attemptId)

        commit.begin(plan)
        recovery.recoverAtStartup(value.jobId)

        assert.equal(repo.get(value.jobId)!.state, 'interrupted')
        assert.equal(attempt(value.attemptId).manifestPath, plan.manifestPath)
        assert.equal(db.select().from(s.medias).all().length, 0)
        assert.equal(tasks()[0].kind, 'rollback_cleanup')
    })

    it('DB 커밋 후 응답이 유실된 작업은 완료로 판정하고 정리 예약을 만들지 않는다', () => {
        const value = finish(started())
        const before = tasks()

        assert.deepEqual(recovery.recoverAtStartup(value.jobId), {
            status: 'committed',
            jobId: value.jobId,
            attemptId: value.attemptId,
            mediaIdSnapshot: value.mediaId
        })

        assert.equal(repo.get(value.jobId)!.state, 'completed')
        assert.deepEqual(tasks(), before)
    })

    it('커밋 시각 0도 성공 표식으로 인정한다', () => {
        now = 0

        const value = finish(started())

        assert.equal(attempt(value.attemptId).committedAt, 0)
        assert.equal(recovery.inspect(value.jobId).status, 'committed')
    })

    it('이후 사용자 편집이나 파생 작업 실패로 과거 완료를 되돌리지 않는다', () => {
        const value = finish(started())

        db.update(s.medias)
            .set({
                customTitle: 'edited',
                revision: 1
            })
            .run()

        db.update(s.maintenanceTasks)
            .set({
                state: 'failed',
                lastError: 'fixture'
            })
            .run()

        assert.equal(recovery.recoverAtStartup(value.jobId).status, 'committed')
        assert.equal(db.select().from(s.medias).get()!.customTitle, 'edited')
    })

    it('후속 재다운로드가 완료돼 마지막 커밋 ID가 바뀌어도 이전 완료를 유지한다', () => {
        const first = finish(started())
        const parent = db.select().from(s.medias).get()!

        const job = repo.enqueue({
            requestUrlId: parent.requestUrlId!,
            originalUrl: 'https://example.invalid/set',
            mode: 'replace',
            mediaId: parent.id,
            expectedRevision: parent.revision
        })

        const { attempt } = repo.startAttempt(job.id, 'manual_initial')

        finish({
            jobId: job.id,
            attemptId: attempt.id
        })

        assert.equal(recovery.inspect(first.jobId).status, 'committed')
        assert.equal(recovery.inspect(job.id).status, 'committed')
    })

    it('완료 부모가 등록 해제돼도 과거 성공과 ID 스냅샷을 유지한다', () => {
        const value = finish(started())

        db.delete(s.medias).where(eq(s.medias.id, value.mediaId)).run()

        assert.equal(repo.get(value.jobId)!.targetMediaId, null)
        assert.equal(attempt(value.attemptId).targetMediaId, null)

        assert.deepEqual(recovery.inspect(value.jobId), {
            status: 'committed',
            jobId: value.jobId,
            attemptId: value.attemptId,
            mediaIdSnapshot: value.mediaId
        })
    })

    it('완료 표식과 job 상태가 충돌하면 임의 보정하지 않는다', () => {
        const value = finish(started())

        db.update(s.downloadQueue)
            .set({ state: 'running' })
            .where(eq(s.downloadQueue.id, value.jobId))
            .run()

        const before = tasks()

        blocked(value.jobId, 'INCONSISTENT_STATE')

        assert.deepEqual(tasks(), before)
    })

    it('미완료 시도가 부모의 커밋 표식에 있으면 보류한다', () => {
        const value = started(true)

        db.update(s.medias)
            .set({
                lastDownloadCommitAttemptId: value.attemptId
            })
            .where(eq(s.medias.id, value.parent!.id))
            .run()

        blocked(value.jobId, 'COMMIT_MARKER_CONFLICT')

        assert.equal(repo.get(value.jobId)!.state, 'running')
        assert.equal(tasks().length, 0)
    })

    it('미완료 시도의 결과 경로가 원본·썸네일·미리보기로 참조되면 보류한다', () => {
        for (const role of ['original', 'thumbnail', 'preview']) {
            const value = started(true)

            verify(value)

            const plan = commit.prepare(value.jobId, value.attemptId)

            commit.begin(plan)

            const path = plan.targets[0].finalPath

            db.update(s.mediaFiles)
                .set(
                    role === 'original'
                        ? { filepath: path }
                        : role === 'thumbnail'
                          ? {
                                thumbnailPath: path,
                                thumbnailOrigin: 'app_generated'
                            }
                          : { previewPath: path }
                )
                .where(eq(s.mediaFiles.mediaId, value.parent!.id))
                .run()

            blocked(value.jobId, 'COMMIT_MARKER_CONFLICT')

            assert.equal(repo.get(value.jobId)!.state, 'running')
        }

        assert.equal(tasks().length, 0)
    })

    it('현재 시도로 연결되지 않은 미완료 이력도 보류한다', () => {
        const value = started()

        db.insert(s.downloadAttempts)
            .values({
                id: 'orphan',
                jobId: value.jobId,
                attemptNo: 2,
                trigger: 'manual_retry',
                phase: 'discovering',
                startedAt: now
            })
            .run()

        blocked(value.jobId, 'UNFINISHED_HISTORY')

        assert.equal(attempt(value.attemptId).outcome, null)
    })

    it('다른 manifest 경로를 정리 대상으로 받아들이지 않는다', () => {
        const value = started()

        db.update(s.downloadAttempts)
            .set({
                manifestPath: join(root, 'foreign.json')
            })
            .where(eq(s.downloadAttempts.id, value.attemptId))
            .run()

        blocked(value.jobId, 'MANIFEST_PATH_MISMATCH')

        assert.equal(tasks().length, 0)
    })

    it('정리 예약이 사라졌으면 cleanupRequired를 해제하지 않는다', () => {
        const value = started()

        recovery.recoverAtStartup(value.jobId)
        db.delete(s.maintenanceTasks).run()

        blocked(value.jobId, 'MISSING_CLEANUP_TASK')

        assert.equal(repo.get(value.jobId)!.cleanupRequired, true)
    })

    it('정리 예약 기록 실패는 중단 상태와 시도 종료도 함께 롤백한다', () => {
        const value = started()

        sqlite.exec(`
            CREATE TRIGGER fail_cleanup
            BEFORE INSERT ON maintenance_task
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        blocked(value.jobId, 'DATABASE_UNAVAILABLE')

        assert.equal(repo.get(value.jobId)!.state, 'running')
        assert.equal(repo.get(value.jobId)!.cleanupRequired, false)
        assert.equal(attempt(value.attemptId).outcome, null)
        assert.equal(tasks().length, 0)
    })

    it('미확인 자동 이력·NULL 횟수·복구 OFF를 변경하지 않는다', () => {
        const value = started()

        db.update(s.downloadQueue)
            .set({
                autoHistoryUnknown: true,
                autoRunCount: null,
                recoveryEnabled: false
            })
            .where(eq(s.downloadQueue.id, value.jobId))
            .run()

        recovery.recoverAtStartup(value.jobId)

        const job = repo.get(value.jobId)!

        assert.equal(job.autoHistoryUnknown, true)
        assert.equal(job.autoRunCount, null)
        assert.equal(job.recoveryEnabled, false)
    })

    it('DB 조회 불가 시 판정을 보류한다', () => {
        const value = started()

        sqlite.close()

        assert.deepEqual(recovery.inspect(value.jobId), {
            status: 'blocked',
            jobId: value.jobId,
            reason: 'DATABASE_UNAVAILABLE'
        })
    })

    it('잘못된 작업 ID와 없는 작업을 구분한다', () => {
        assert.throws(() => recovery.inspect(''), error('INVALID_ARGUMENT'))

        assert.throws(() => recovery.recoverAtStartup('missing'), error('NOT_FOUND'))
    })
})
