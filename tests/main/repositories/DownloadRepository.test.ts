import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { MediaRepository, type V2Database } from '../../../src/main/repositories/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError,
    type EnqueueDownloadInput
} from '../../../src/main/repositories/DownloadRepository'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let serial: number

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

    repo = new DownloadRepository(db, () => 1_800_000_000_000)

    serial = 0
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

function input(): EnqueueDownloadInput {
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

    return {
        requestUrlId: request.id,
        originalUrl: url,
        mode: 'create',
        options: {
            quality: '720',
            playlist: true
        }
    }
}

function attempts() {
    return db.select().from(s.downloadAttempts).all()
}

function terminal(
    jobId: string,
    state: 'failed' | 'cancelled' | 'interrupted',
    extra: Partial<typeof s.downloadQueue.$inferInsert> = {}
) {
    db.update(s.downloadQueue)
        .set({ state, ...extra })
        .where(eq(s.downloadQueue.id, jobId))
        .run()
}

function parent(requestUrlId: number) {
    return new MediaRepository(db).register({
        sourceKind: 'download',
        requestUrlId,
        customTitle: '사용자 제목',
        isFavorite: true,
        files: [
            {
                fileKey: 'one',
                kind: 'image',
                position: 0,
                storageKind: 'app_managed',
                filepath: 'C:/fixture/one.png'
            }
        ]
    })
}

describe('DownloadRepository', () => {
    it('작업만 pending으로 기록하고 옵션·원본 URL·기본 복구 정책을 보존한다', () => {
        const request = input()
        const job = repo.enqueue(request)

        assert.equal(job.state, 'pending')
        assert.equal(job.originalUrl, request.originalUrl)
        assert.deepEqual(JSON.parse(job.optionsJson), request.options)
        assert.equal(job.recoveryEnabled, false)
        assert.equal(job.autoRunLimit, 1)
        assert.equal(job.autoRunCount, 0)
        assert.equal(job.autoHistoryUnknown, false)
        assert.equal(job.currentAttemptId, null)
        assert.equal(job.createdAt, 1_800_000_000_000)
        assert.equal(attempts().length, 0)
        assert.deepEqual(repo.get(job.id), job)
        assert.deepEqual(repo.list(), [job])
        assert.equal(db.select().from(s.medias).all().length, 0)
    })

    it('같은 URL의 대기·실행 작업을 중복 등록하지 않는다', () => {
        const request = input()
        const job = repo.enqueue(request)

        assert.throws(() => repo.enqueue(request), error('ALREADY_PROCESSING'))

        repo.startAttempt(job.id, 'manual_initial')

        assert.throws(() => repo.enqueue(request), error('ALREADY_PROCESSING'))

        assert.equal(repo.list().length, 1)
    })

    it('기존 묶음이 있으면 새 작업 대신 재다운로드 확인을 요구한다', () => {
        const request = input()
        const media = parent(request.requestUrlId)

        assert.throws(() => repo.enqueue(request), error('REDOWNLOAD_CONFIRMATION_REQUIRED'))

        assert.equal(repo.list().length, 0)

        assert.equal(new MediaRepository(db).get(media.media.id)?.media.customTitle, '사용자 제목')
    })

    it('재다운로드는 부모·파일을 유지하고 ID와 revision을 확인해 작업만 만든다', () => {
        const request = input()
        const media = parent(request.requestUrlId)

        const job = repo.enqueue({
            ...request,
            mode: 'replace',
            mediaId: media.media.id,
            expectedRevision: media.media.revision
        })

        assert.equal(job.targetMediaId, media.media.id)
        assert.equal(job.targetMediaIdSnapshot, media.media.id)

        assert.deepEqual(new MediaRepository(db).get(media.media.id), media)

        assert.throws(
            () => new MediaRepository(db).unregisterMedia(media.media.id, 0),
            (value: unknown) => value instanceof Error && value.message === 'JOB_ACTIVE'
        )
    })

    it('오래된 revision은 새 작업을 만들지 않는다', () => {
        const request = input()
        const media = parent(request.requestUrlId)

        assert.throws(
            () =>
                repo.enqueue({
                    ...request,
                    mode: 'replace',
                    mediaId: media.media.id,
                    expectedRevision: 99
                }),
            error('REVISION_CONFLICT')
        )

        assert.equal(repo.list().length, 0)
    })

    it('다른 URL이나 출처 미확정 부모를 재다운로드 대상으로 추정하지 않는다', () => {
        const request = input()
        const another = input()
        const media = parent(request.requestUrlId)

        assert.throws(
            () =>
                repo.enqueue({
                    ...another,
                    mode: 'replace',
                    mediaId: media.media.id,
                    expectedRevision: 0
                }),
            error('INVALID_ARGUMENT')
        )

        const legacy = db
            .insert(s.medias)
            .values({
                sourceKind: 'legacy'
            })
            .returning()
            .get()

        assert.throws(
            () =>
                repo.enqueue({
                    ...request,
                    mode: 'replace',
                    mediaId: legacy.id,
                    expectedRevision: 0
                }),
            error('INVALID_ARGUMENT')
        )

        assert.equal(repo.list().length, 0)
    })

    it('첫 실행 시 작업·시도·현재 시도 연결을 함께 반영한다', () => {
        const job = repo.enqueue(input())

        const result = repo.startAttempt(job.id, 'manual_initial')

        assert.equal(result.job.state, 'running')
        assert.equal(result.job.currentAttemptId, result.attempt.id)
        assert.equal(result.attempt.jobId, job.id)
        assert.equal(result.attempt.attemptNo, 1)
        assert.equal(result.attempt.phase, 'discovering')
        assert.equal(result.attempt.outcome, null)
        assert.equal(result.attempt.committedAt, null)
        assert.equal(result.job.autoRunCount, 0)
        assert.equal(attempts().length, 1)

        assert.throws(() => repo.startAttempt(job.id, 'manual_initial'), error('INVALID_STATE'))

        assert.equal(attempts().length, 1)
    })

    it('수동 재시도는 이전 시도를 보존하고 자동 횟수·메타데이터를 유지한다', () => {
        const job = repo.enqueue(input())

        const first = repo.startAttempt(job.id, 'manual_initial')

        db.update(s.downloadAttempts)
            .set({
                phase: 'finished',
                outcome: 'failed',
                finishedAt: 1000
            })
            .where(eq(s.downloadAttempts.id, first.attempt.id))
            .run()

        terminal(job.id, 'failed', {
            autoRunCount: 3,
            title: '보존 제목',
            log: '보존 로그'
        })

        const next = repo.startAttempt(job.id, 'manual_retry')

        assert.equal(next.attempt.attemptNo, 2)
        assert.equal(next.attempt.trigger, 'manual_retry')
        assert.equal(next.job.autoRunCount, 3)
        assert.equal(next.job.title, '보존 제목')
        assert.equal(next.job.log, '보존 로그')
        assert.equal(attempts().length, 2)

        assert.equal(attempts().find((row) => row.id === first.attempt.id)?.outcome, 'failed')
    })

    it('수동 다시 시작은 미확인 자동 이력과 NULL 횟수를 유지한다', () => {
        for (const state of ['cancelled', 'interrupted'] as const) {
            const job = repo.enqueue(input())

            terminal(job.id, state, {
                autoHistoryUnknown: true,
                autoRunCount: null,
                recoveryEnabled: false
            })

            const result = repo.startAttempt(job.id, 'manual_restart')

            assert.equal(result.job.autoHistoryUnknown, true)
            assert.equal(result.job.autoRunCount, null)
            assert.equal(result.job.recoveryEnabled, false)
        }
    })

    it('허용된 자동 복구는 실행 시작 전에 누적 횟수와 시도를 함께 기록한다', () => {
        const job = repo.enqueue({
            ...input(),
            recoveryEnabled: true,
            autoRunLimit: 2
        })

        terminal(job.id, 'interrupted')

        const result = repo.startAttempt(job.id, 'auto_recovery')

        assert.equal(result.job.autoRunCount, 1)
        assert.equal(repo.get(job.id)?.autoRunCount, 1)
        assert.equal(result.attempt.trigger, 'auto_recovery')
        assert.equal(attempts().length, 1)
    })

    it('복구 OFF·미확인 이력·한도 소진은 시도를 만들지 않는다', () => {
        const disabled = repo.enqueue(input())

        terminal(disabled.id, 'interrupted')

        assert.throws(
            () => repo.startAttempt(disabled.id, 'auto_recovery'),
            error('AUTO_RECOVERY_DISABLED')
        )

        const unknown = repo.enqueue(input())

        terminal(unknown.id, 'interrupted', {
            autoHistoryUnknown: true,
            autoRunCount: null
        })

        assert.throws(
            () => repo.startAttempt(unknown.id, 'auto_recovery'),
            error('AUTO_HISTORY_UNKNOWN')
        )

        const limited = repo.enqueue({
            ...input(),
            recoveryEnabled: true,
            autoRunLimit: 0
        })

        terminal(limited.id, 'interrupted')

        assert.throws(
            () => repo.startAttempt(limited.id, 'auto_recovery'),
            error('AUTO_LIMIT_REACHED')
        )

        assert.equal(attempts().length, 0)
    })

    it('자동 복구는 일반 실패·취소·완료 상태를 실행하지 않는다', () => {
        const job = repo.enqueue({
            ...input(),
            recoveryEnabled: true
        })

        for (const state of ['failed', 'cancelled', 'completed'] as const) {
            db.update(s.downloadQueue).set({ state }).where(eq(s.downloadQueue.id, job.id)).run()

            assert.throws(() => repo.startAttempt(job.id, 'auto_recovery'), error('INVALID_STATE'))
        }

        assert.equal(attempts().length, 0)
    })

    it('정리 필요 작업은 같은 URL의 신규 등록과 재실행을 막는다', () => {
        const request = input()
        const job = repo.enqueue(request)

        terminal(job.id, 'failed', {
            cleanupRequired: true
        })

        assert.throws(() => repo.enqueue(request), error('CLEANUP_REQUIRED'))

        assert.throws(() => repo.startAttempt(job.id, 'manual_retry'), error('CLEANUP_REQUIRED'))

        assert.equal(attempts().length, 0)
    })

    it('현재 시도로 연결되지 않은 미완료 시도도 중복 실행을 막는다', () => {
        const request = input()
        const job = repo.enqueue(request)

        terminal(job.id, 'interrupted')

        db.insert(s.downloadAttempts)
            .values({
                id: 'unfinished',
                jobId: job.id,
                attemptNo: 1,
                trigger: 'manual_initial',
                phase: 'downloading',
                startedAt: 1000
            })
            .run()

        assert.throws(() => repo.startAttempt(job.id, 'manual_restart'), error('INVALID_STATE'))

        assert.throws(() => repo.enqueue(request), error('ALREADY_PROCESSING'))

        assert.equal(attempts().length, 1)
    })

    it('작업 갱신 실패는 새 시도와 자동 횟수 증가를 함께 롤백한다', () => {
        const job = repo.enqueue({
            ...input(),
            recoveryEnabled: true
        })

        terminal(job.id, 'interrupted')

        sqlite.exec(`
            CREATE TRIGGER reject_start
            BEFORE UPDATE OF current_attempt_id
            ON download_queue
            BEGIN
                SELECT RAISE(
                    ABORT,
                    'fixture failure'
                );
            END;
        `)

        assert.throws(() => repo.startAttempt(job.id, 'auto_recovery'))

        assert.equal(attempts().length, 0)
        assert.equal(repo.get(job.id)?.state, 'interrupted')
        assert.equal(repo.get(job.id)?.currentAttemptId, null)
        assert.equal(repo.get(job.id)?.autoRunCount, 0)
    })

    it('존재하지 않는 대상·잘못된 옵션·한도·페이지를 거부한다', () => {
        const request = input()

        assert.throws(
            () =>
                repo.enqueue({
                    ...request,
                    requestUrlId: 99999
                }),
            error('NOT_FOUND')
        )

        assert.throws(
            () =>
                repo.enqueue({
                    ...request,
                    options: {
                        quality: 'invalid'
                    } as never
                }),
            error('INVALID_ARGUMENT')
        )

        assert.throws(
            () =>
                repo.enqueue({
                    ...request,
                    options: {
                        excludeIds: ['one']
                    } as never
                }),
            error('INVALID_ARGUMENT')
        )

        assert.throws(
            () =>
                repo.enqueue({
                    ...request,
                    autoRunLimit: -1
                }),
            error('INVALID_ARGUMENT')
        )

        assert.throws(() => repo.list({ limit: 201 }), error('INVALID_ARGUMENT'))

        assert.throws(() => repo.startAttempt('absent', 'manual_initial'), error('NOT_FOUND'))

        assert.equal(repo.list().length, 0)
    })
})
