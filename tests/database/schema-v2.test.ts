import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as v2 from '../../src/database/schema-v2'
import { schemaV2Guards } from '../../src/database/schema-v2.guards'
import { schemaV2Sql } from '../../src/database/schema-v2.sql'

let sqlite: Database.Database
let db: ReturnType<typeof drizzle<typeof v2>>

beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...schemaV2Sql, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: v2 })
})

afterEach(() => sqlite.close())

function parent(sourceKind: 'legacy' | 'local' = 'legacy') {
    return db.insert(v2.medias).values({ sourceKind }).returning().get()
}

function file(mediaId: number, position = 0) {
    return db
        .insert(v2.mediaFiles)
        .values({
            mediaId,
            position,
            fileKey: 'file-' + position,
            storageKind: 'unverified_legacy',
            kind: 'unknown',
            filepath: 'C:/fixture/' + mediaId + '-' + position
        })
        .returning()
        .get()
}

function job(id: string, targetMediaId?: number) {
    const url = db
        .insert(v2.downloadUrls)
        .values({
            url: 'https://example.invalid/' + id,
            normalizedUrl: 'https://example.invalid/' + id,
            normalizationVersion: 1
        })
        .returning()
        .get()

    db.insert(v2.downloadQueue)
        .values({
            id,
            requestUrlId: url.id,
            originalUrl: url.url,
            mode: targetMediaId ? 'replace' : 'create',
            targetMediaId,
            targetMediaIdSnapshot: targetMediaId,
            optionsJson: '{}'
        })
        .run()
}

describe('v2 schema constraints', () => {
    it('20개 테이블과 정상 외래키를 생성한다', () => {
        const rows = sqlite
            .prepare(
                `
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        `
            )
            .all()

        const triggerCount = sqlite
            .prepare(
                `
            SELECT count(*) FROM sqlite_master
            WHERE type = 'trigger'
        `
            )
            .pluck()
            .get()

        expect(rows).toHaveLength(20)
        expect(triggerCount).toBe(9)

        expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok')

        expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })

    it('다른 부모의 파일을 표지로 지정하지 못한다', () => {
        const a = parent()
        const b = parent()
        const child = file(b.id)

        expect(() =>
            sqlite
                .prepare(
                    `
      UPDATE media
      SET cover_mode = 'manual', cover_file_id = ?
      WHERE id = ?
    `
                )
                .run(child.id, a.id)
        ).toThrow()
    })

    it('같은 부모의 파일 키·순서 중복을 막는다', () => {
        const p = parent()

        file(p.id)

        expect(() => file(p.id)).toThrow()
    })

    it('외부 참조 파일의 필수 정보를 검사한다', () => {
        const p = parent('local')

        expect(() =>
            db
                .insert(v2.mediaFiles)
                .values({
                    mediaId: p.id,
                    fileKey: 'external',
                    storageKind: 'external_reference',
                    kind: 'image',
                    position: 0,
                    filepath: 'C:/fixture/a.png'
                })
                .run()
        ).toThrow()
    })

    it('로컬 출처가 아닌 부모에 로컬 폴더를 연결하지 못한다', () => {
        const p = parent()

        expect(() =>
            db
                .insert(v2.localFolders)
                .values({
                    mediaId: p.id,
                    sourceTitle: 'wrong'
                })
                .run()
        ).toThrow()
    })

    it('다른 작업의 실행 시도를 현재 시도로 지정하지 못한다', () => {
        job('a')
        job('b')

        db.insert(v2.downloadAttempts)
            .values({
                id: 'attempt-a',
                jobId: 'a',
                attemptNo: 1,
                trigger: 'manual_initial',
                phase: 'discovering',
                startedAt: Date.now()
            })
            .run()

        expect(() =>
            sqlite
                .prepare(
                    `
      UPDATE download_queue
      SET current_attempt_id = ?
      WHERE id = ?
    `
                )
                .run('attempt-a', 'b')
        ).toThrow()
    })

    it('실행 중 삭제를 막고 완료 이력의 과거 ID를 보존한다', () => {
        const p = parent()

        file(p.id)
        job('a', p.id)

        expect(() => sqlite.prepare('DELETE FROM media WHERE id = ?').run(p.id)).toThrow(
            'JOB_ACTIVE'
        )

        sqlite
            .prepare(
                `
      UPDATE download_queue SET state = 'completed'
      WHERE id = 'a'
    `
            )
            .run()

        sqlite.prepare('DELETE FROM media WHERE id = ?').run(p.id)

        const row = sqlite
            .prepare(
                `
      SELECT target_media_id, target_media_id_snapshot
      FROM download_queue WHERE id = 'a'
    `
            )
            .get() as {
            target_media_id: number | null
            target_media_id_snapshot: number
        }

        expect(row.target_media_id).toBeNull()
        expect(row.target_media_id_snapshot).toBe(p.id)
    })

    it('과거 자동 실행 횟수가 미확인이면 자동 복구를 막는다', () => {
        job('a')

        sqlite
            .prepare(
                `
      UPDATE download_queue
      SET auto_history_unknown = 1, auto_run_count = NULL
      WHERE id = 'a'
    `
            )
            .run()

        expect(() =>
            sqlite
                .prepare(
                    `
      UPDATE download_queue SET recovery_enabled = 1
      WHERE id = 'a'
    `
                )
                .run()
        ).toThrow()
    })

    it('배포용 SQL이 현재 Drizzle 스키마와 일치한다', async () => {
        const generated = await generateSQLiteMigration(
            await generateSQLiteDrizzleJson({}),
            await generateSQLiteDrizzleJson(v2)
        )

        const normalize = (statement: string) =>
            statement.replaceAll('`', '"').replace(/\s+/g, ' ').trim()

        expect(schemaV2Sql.map(normalize).sort()).toEqual(generated.map(normalize).sort())
    })
})
