import assert from 'node:assert/strict'
import { resolve } from 'node:path'
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
    DownloadRepositoryError,
    type DownloadTargetInput
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

function start() {
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

    const job = repo.enqueue({
        requestUrlId: request.id,
        originalUrl: url,
        mode: 'create'
    })

    const { attempt } = repo.startAttempt(job.id, 'manual_initial')

    return {
        jobId: job.id,
        attemptId: attempt.id
    }
}

function target(key: string): DownloadTargetInput {
    return {
        targetKey: key,
        sourceUrl: 'https://example.invalid/item/' + key,
        metadata: {
            kind: 'image',
            title: key,
            ownerName: null
        }
    }
}

// 경로 문자열만 사용하며 실제 폴더·파일은 만들지 않는다.
function result(key: string) {
    return {
        targetKey: key,
        stagedPath: resolve('fixture', key + '.png')
    }
}

function phase(attemptId: string) {
    return db.select().from(s.downloadAttempts).where(eq(s.downloadAttempts.id, attemptId)).get()!
        .phase
}

describe('download target snapshots', () => {
    it('대상 순서·키·URL·NULL 메타데이터를 보존하고 목록을 고정한다', () => {
        const { jobId, attemptId } = start()
        const a = target('a')
        const b = target('b')

        repo.freezeTargets(jobId, attemptId, [b, a])

        const page = repo.listTargets(jobId, attemptId)

        assert.deepEqual(
            page.data.map((row) => row.targetKey),
            ['b', 'a']
        )

        assert.deepEqual(
            page.data.map((row) => row.position),
            [0, 1]
        )

        assert.equal(page.data[1].sourceUrl, a.sourceUrl)

        assert.deepEqual(JSON.parse(page.data[1].metadataJson), a.metadata)

        assert.ok(
            page.data.every(
                (row) =>
                    row.state === 'pending' && row.stagedPath === null && row.finalPath === null
            )
        )

        assert.equal(phase(attemptId), 'downloading')

        assert.equal(repo.get(jobId)?.state, 'running')

        assert.equal(db.select().from(s.medias).all().length, 0)
    })

    it('빈 대상 목록은 진행 단계와 DB를 변경하지 않는다', () => {
        const { jobId, attemptId } = start()

        assert.throws(
            () => repo.freezeTargets(jobId, attemptId, []),
            error('TARGET_DISCOVERY_EMPTY')
        )

        assert.equal(phase(attemptId), 'discovering')

        assert.equal(repo.listTargets(jobId, attemptId).total, 0)
    })

    it('중복 대상 키는 목록 전체를 거부한다', () => {
        const { jobId, attemptId } = start()

        assert.throws(
            () => repo.freezeTargets(jobId, attemptId, [target('a'), target('a')]),
            error('TARGET_DUPLICATE')
        )

        assert.equal(repo.listTargets(jobId, attemptId).total, 0)

        assert.equal(phase(attemptId), 'discovering')
    })

    it('잘못된 URL·메타데이터와 허용하지 않은 필드를 거부한다', () => {
        const { jobId, attemptId } = start()

        for (const invalid of [
            {
                ...target('a'),
                sourceUrl: 'file:///fixture/a'
            },
            {
                ...target('a'),
                metadata: { kind: 'invalid' }
            },
            {
                ...target('a'),
                metadata: {
                    kind: 'image',
                    cookies: 'secret'
                }
            },
            {
                ...target('a'),
                metadata: {
                    kind: 'image',
                    duration: NaN
                }
            },
            {
                ...target('a'),
                metadata: {
                    kind: 'image',
                    ownerName: 1
                }
            }
        ]) {
            assert.throws(
                () => repo.freezeTargets(jobId, attemptId, [invalid as never]),
                error('INVALID_ARGUMENT')
            )
        }

        assert.equal(repo.listTargets(jobId, attemptId).total, 0)
    })

    it('두 번째 대상 삽입 실패는 첫 행과 단계 변경도 롤백한다', () => {
        const { jobId, attemptId } = start()

        sqlite.exec(`
            CREATE TRIGGER reject_target
            BEFORE INSERT ON download_target
            WHEN NEW.target_key = 'b'
            BEGIN
                SELECT RAISE(ABORT, 'fixture failure');
            END;
        `)

        assert.throws(() => repo.freezeTargets(jobId, attemptId, [target('a'), target('b')]))

        assert.equal(repo.listTargets(jobId, attemptId).total, 0)

        assert.equal(phase(attemptId), 'discovering')
    })

    it('한 번 고정한 목록을 추가·교체하지 않는다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a')])

        const before = repo.listTargets(jobId, attemptId)

        assert.throws(
            () => repo.freezeTargets(jobId, attemptId, [target('b')]),
            error('INVALID_STATE')
        )

        assert.deepEqual(repo.listTargets(jobId, attemptId), before)
    })

    it('일부 결과 누락은 어떠한 대상도 downloaded로 변경하지 않는다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a'), target('b')])

        assert.throws(
            () => repo.recordResults(jobId, attemptId, [result('a')]),
            error('TARGET_INCOMPLETE')
        )

        assert.ok(
            repo
                .listTargets(jobId, attemptId)
                .data.every((row) => row.state === 'pending' && row.stagedPath === null)
        )

        assert.equal(phase(attemptId), 'downloading')
    })

    it('빈 결과·중복 결과·예정에 없는 결과를 성공으로 처리하지 않는다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a'), target('b')])

        assert.throws(() => repo.recordResults(jobId, attemptId, []), error('TARGET_INCOMPLETE'))

        assert.throws(
            () => repo.recordResults(jobId, attemptId, [result('a'), result('a')]),
            error('TARGET_DUPLICATE')
        )

        assert.throws(
            () => repo.recordResults(jobId, attemptId, [result('a'), result('c')]),
            error('TARGET_UNEXPECTED_RESULT')
        )

        assert.equal(phase(attemptId), 'downloading')
    })

    it('같은 경로를 다른 대상 결과로 중복 등록하지 않는다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a'), target('b')])

        assert.throws(
            () =>
                repo.recordResults(jobId, attemptId, [
                    result('a'),
                    {
                        targetKey: 'b',
                        stagedPath: resolve('fixture', 'sub', '..', 'a.png')
                    }
                ]),
            error('TARGET_PATH_COLLISION')
        )

        assert.ok(repo.listTargets(jobId, attemptId).data.every((row) => row.state === 'pending'))
    })

    it('결과 순서와 관계없이 정확한 키에 연결하고 물리 검증 전에는 완료하지 않는다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a'), target('b')])

        repo.recordResults(jobId, attemptId, [result('b'), result('a')])

        const rows = repo.listTargets(jobId, attemptId).data

        assert.deepEqual(
            rows.map((row) => row.targetKey),
            ['a', 'b']
        )

        assert.deepEqual(
            rows.map((row) => row.stagedPath),
            [result('a').stagedPath, result('b').stagedPath]
        )

        assert.ok(rows.every((row) => row.state === 'downloaded' && row.finalPath === null))

        assert.equal(phase(attemptId), 'verifying')

        assert.equal(repo.get(jobId)?.state, 'running')

        assert.equal(db.select().from(s.medias).all().length, 0)
    })

    it('빈 경로와 상대 경로를 거부한다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a')])

        for (const stagedPath of ['', 'relative/a.png']) {
            assert.throws(
                () =>
                    repo.recordResults(jobId, attemptId, [
                        {
                            targetKey: 'a',
                            stagedPath
                        }
                    ]),
                error('INVALID_ARGUMENT')
            )
        }

        assert.equal(phase(attemptId), 'downloading')
    })

    it('결과 기록 후 재기록으로 경로를 덮어쓰지 않는다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a')])

        repo.recordResults(jobId, attemptId, [result('a')])

        const before = repo.listTargets(jobId, attemptId)

        assert.throws(
            () => repo.recordResults(jobId, attemptId, [result('a')]),
            error('INVALID_STATE')
        )

        assert.deepEqual(repo.listTargets(jobId, attemptId), before)
    })

    it('다른 작업의 실행 시도를 변경하거나 조회하지 않는다', () => {
        const a = start()
        const b = start()

        assert.throws(
            () => repo.freezeTargets(a.jobId, b.attemptId, [target('a')]),
            error('NOT_FOUND')
        )

        assert.throws(() => repo.listTargets(a.jobId, b.attemptId), error('NOT_FOUND'))

        assert.equal(phase(a.attemptId), 'discovering')

        assert.equal(phase(b.attemptId), 'discovering')
    })

    it('취소 요청 시각이 0이어도 대상 고정과 결과 기록을 막는다', () => {
        const { jobId, attemptId } = start()

        const cancel = (value: number | null) =>
            db
                .update(s.downloadAttempts)
                .set({
                    cancelRequestedAt: value
                })
                .where(eq(s.downloadAttempts.id, attemptId))
                .run()

        cancel(0)

        assert.throws(
            () => repo.freezeTargets(jobId, attemptId, [target('a')]),
            error('CANCEL_REQUESTED')
        )

        cancel(null)

        repo.freezeTargets(jobId, attemptId, [target('a')])

        cancel(0)

        assert.throws(
            () => repo.recordResults(jobId, attemptId, [result('a')]),
            error('CANCEL_REQUESTED')
        )

        assert.equal(phase(attemptId), 'downloading')
    })

    it('정리 필요와 비실행 작업의 상태 전이를 막는다', () => {
        const { jobId, attemptId } = start()

        db.update(s.downloadQueue)
            .set({ cleanupRequired: true })
            .where(eq(s.downloadQueue.id, jobId))
            .run()

        assert.throws(
            () => repo.freezeTargets(jobId, attemptId, [target('a')]),
            error('CLEANUP_REQUIRED')
        )

        db.update(s.downloadQueue)
            .set({
                cleanupRequired: false,
                state: 'interrupted'
            })
            .where(eq(s.downloadQueue.id, jobId))
            .run()

        assert.throws(
            () => repo.freezeTargets(jobId, attemptId, [target('a')]),
            error('INVALID_STATE')
        )

        assert.equal(repo.listTargets(jobId, attemptId).total, 0)
    })

    it('두 번째 결과 갱신 실패는 첫 결과와 단계 변경도 롤백한다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a'), target('b')])

        sqlite.exec(`
            CREATE TRIGGER reject_result
            BEFORE UPDATE OF staged_path
            ON download_target
            WHEN NEW.target_key = 'b'
            BEGIN
                SELECT RAISE(ABORT, 'fixture failure');
            END;
        `)

        assert.throws(() => repo.recordResults(jobId, attemptId, [result('a'), result('b')]))

        assert.ok(
            repo
                .listTargets(jobId, attemptId)
                .data.every((row) => row.state === 'pending' && row.stagedPath === null)
        )

        assert.equal(phase(attemptId), 'downloading')
    })

    it('대상을 DB에서 페이지 조회하고 잘못된 페이지·실행 ID를 거부한다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a'), target('b')])

        const first = repo.listTargets(jobId, attemptId, { limit: 1 })

        const second = repo.listTargets(jobId, attemptId, {
            limit: 1,
            offset: 1
        })

        assert.equal(first.total, 2)
        assert.equal(first.hasNextPage, true)
        assert.equal(first.data[0].targetKey, 'a')
        assert.equal(second.hasNextPage, false)
        assert.equal(second.data[0].targetKey, 'b')

        assert.throws(
            () => repo.listTargets(jobId, attemptId, { limit: 201 }),
            error('INVALID_ARGUMENT')
        )

        assert.throws(() => repo.listTargets(jobId, 'absent'), error('NOT_FOUND'))
    })

    it('재시도의 이전 목록은 조회할 수 있지만 다시 변경할 수 없다', () => {
        const { jobId, attemptId } = start()

        repo.freezeTargets(jobId, attemptId, [target('a')])

        db.update(s.downloadAttempts)
            .set({
                phase: 'finished',
                outcome: 'failed',
                finishedAt: 1_800_000_000_001
            })
            .where(eq(s.downloadAttempts.id, attemptId))
            .run()

        db.update(s.downloadQueue)
            .set({ state: 'failed' })
            .where(eq(s.downloadQueue.id, jobId))
            .run()

        const next = repo.startAttempt(jobId, 'manual_retry')

        assert.equal(repo.listTargets(jobId, attemptId).total, 1)

        assert.throws(
            () => repo.recordResults(jobId, attemptId, [result('a')]),
            error('INVALID_STATE')
        )

        repo.freezeTargets(jobId, next.attempt.id, [target('b')])

        assert.equal(repo.listTargets(jobId, next.attempt.id).data[0].targetKey, 'b')

        assert.equal(repo.listTargets(jobId, attemptId).data[0].targetKey, 'a')
    })
})
