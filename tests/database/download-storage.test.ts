import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as s from '../../src/database/schema-v2'
import { schemaV2Sql } from '../../src/database/schema-v2.sql'
import {
    migrateDatabase,
    legacyNumericTimeUnit,
    type Version3MigrationOptions
} from '../../src/database/migrate'
import type { V2Database } from '@features/media/MediaRepository'
import { DownloadRepository } from '@features/download/DownloadRepository'
import { DownloadRootRepository } from '@features/download/DownloadRootRepository'

const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url))
})

const rootA = resolve('fixture-download-A')
const rootB = resolve('fixture-download-B')

let sqlite: Database.Database
let db: V2Database
let jobs: DownloadRepository
let backups: number

function input(extra: Partial<Version3MigrationOptions> = {}): Version3MigrationOptions {
    return {
        legacyMigrations: migrations,
        schemaSql: [...schemaV2Sql],
        backupDirectory: 'unused',
        numericTimeUnit: legacyNumericTimeUnit,
        legacyStorageRoot: rootA,
        backup: async (source) => {
            backups++

            return {
                path: 'memory-backup',
                connection: new Database(source.serialize())
            }
        },
        ...extra
    }
}

beforeEach(async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    backups = 0

    await migrateDatabase(sqlite, {
        ...input(),
        targetVersion: 2
    })

    backups = 0
    db = drizzle(sqlite, { schema: s })
    jobs = new DownloadRepository(db)
})

afterEach(() => {
    try {
        expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
        sqlite.close()
    }
})

function queued(name: string) {
    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/' + name,
            normalizedUrl: 'https://example.invalid/' + name,
            normalizationVersion: 1
        })
        .returning()
        .get()

    return jobs.enqueue({
        mode: 'create',
        requestUrlId: url.id,
        originalUrl: url.url
    })
}

const upgrade = (extra: Partial<Version3MigrationOptions> = {}) =>
    migrateDatabase(sqlite, {
        ...input(extra),
        targetVersion: 3
    })

function version() {
    return sqlite.pragma('user_version', { simple: true })
}

function hasBindings() {
    return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='download_job_storage'").get()
}

describe('작업별 다운로드 저장 루트', () => {
    it('기존 작업 A와 새 작업 B를 구분하고 재실행으로 A를 덮어쓰지 않는다', async () => {
        const old = queued('old')
        await upgrade()

        const roots = new DownloadRootRepository(db)

        expect(roots.get(old.id)).toBe(rootA)

        const added = db.transaction((tx) => {
            const job = queued('new')
            new DownloadRootRepository(tx).bind(job.id, rootB)
            return job
        })

        expect(roots.get(old.id)).toBe(rootA)
        expect(roots.get(added.id)).toBe(rootB)

        const again = await upgrade({
            legacyStorageRoot: rootB
        })

        expect(again.version).toBe(3)

        if (again.version !== 3) {
            throw new Error('Expected version 3')
        }

        expect(again.migrated).toBe(false)
        expect(roots.get(old.id)).toBe(rootA)
        expect(roots.get(added.id)).toBe(rootB)
        expect(backups).toBe(1)
        expect(version()).toBe(3)
    })

    it('기존 미디어·외부 원본 경로와 사용자 제목을 보존한다', async () => {
        const parent = db
            .insert(s.medias)
            .values({
                sourceKind: 'legacy',
                sourceTitle: '원제목',
                customTitle: '사용자 제목'
            })
            .returning()
            .get()

        db.insert(s.mediaFiles)
            .values({
                mediaId: parent.id,
                fileKey: 'legacy',
                storageKind: 'unverified_legacy',
                filepath: join(rootA, 'original.png'),
                kind: 'unknown',
                position: 0
            })
            .run()

        const before = db.select().from(s.mediaFiles).all()

        await upgrade()

        expect(db.select().from(s.mediaFiles).all()).toEqual(before)

        expect(db.select().from(s.medias).get()!.customTitle).toBe('사용자 제목')
    })

    it('기존 작업의 루트가 명시되지 않으면 백업·변경 전에 보류한다', async () => {
        queued('old')

        await expect(upgrade({ legacyStorageRoot: undefined })).rejects.toThrow(
            'DOWNLOAD_STORAGE_ROOT_REQUIRED'
        )

        expect(backups).toBe(0)
        expect(version()).toBe(2)
        expect(hasBindings()).toBe(false)
    })

    it('기존 실행 경로와 지정한 루트가 다르면 보류한다', async () => {
        const job = queued('old')
        const { attempt } = jobs.startAttempt(job.id, 'manual_initial')

        const owner = createHash('sha256')
            .update(JSON.stringify([job.id, attempt.id]))
            .digest('hex')

        db.update(s.downloadAttempts)
            .set({
                manifestPath: join(rootA, '.storagebucket', 'manifests', owner + '.json')
            })
            .where(eq(s.downloadAttempts.id, attempt.id))
            .run()

        await expect(upgrade({ legacyStorageRoot: rootB })).rejects.toThrow(
            'DOWNLOAD_STORAGE_ROOT_CONFLICT'
        )

        expect(backups).toBe(0)
        expect(version()).toBe(2)
        expect(hasBindings()).toBe(false)
    })

    it('트랜잭션 실패 시 테이블·경로 기록·버전·이관 이력을 롤백한다', async () => {
        const job = queued('old')

        await expect(
            upgrade({
                checkpoint(stage) {
                    if (stage === 'before_commit') {
                        throw new Error('INJECTED')
                    }
                }
            })
        ).rejects.toThrow('INJECTED')

        expect(backups).toBe(1)
        expect(version()).toBe(2)
        expect(hasBindings()).toBe(false)
        expect(jobs.get(job.id)!.state).toBe('pending')

        expect(
            sqlite
                .prepare('SELECT count(*) FROM migration_run WHERE target_version=3')
                .pluck()
                .get()
        ).toBe(0)
    })

    it('백업의 자식 데이터가 다르면 원본을 변경하지 않는다', async () => {
        const parent = db
            .insert(s.medias)
            .values({
                sourceKind: 'legacy'
            })
            .returning()
            .get()

        db.insert(s.mediaFiles)
            .values({
                mediaId: parent.id,
                fileKey: 'legacy',
                storageKind: 'unverified_legacy',
                filepath: join(rootA, 'keep.png'),
                kind: 'unknown',
                position: 0
            })
            .run()

        await expect(
            upgrade({
                backup: async (source) => {
                    const copy = new Database(source.serialize())

                    copy.exec("UPDATE media_file SET title='changed'")

                    return {
                        path: 'wrong-copy',
                        connection: copy
                    }
                }
            })
        ).rejects.toThrow('BACKUP_MISMATCH')

        expect(version()).toBe(2)
        expect(hasBindings()).toBe(false)
    })

    it('백업 중 다른 변경이 생기면 그 변경을 보존하고 이관을 보류한다', async () => {
        queued('old')

        await expect(
            upgrade({
                backup: async (source) => {
                    const copy = new Database(source.serialize())

                    source.exec("UPDATE download_queue SET title='concurrent'")

                    return {
                        path: 'memory-copy',
                        connection: copy
                    }
                }
            })
        ).rejects.toThrow('SOURCE_CHANGED')

        expect(version()).toBe(2)
        expect(hasBindings()).toBe(false)

        expect(sqlite.prepare('SELECT title FROM download_queue').pluck().get()).toBe('concurrent')
    })

    it('기록한 루트는 UPDATE·DELETE로 바꾸거나 분리하지 못한다', async () => {
        const job = queued('old')
        await upgrade()

        expect(() =>
            sqlite
                .prepare('UPDATE download_job_storage SET storage_root=? WHERE job_id=?')
                .run(rootB, job.id)
        ).toThrow('DOWNLOAD_STORAGE_IMMUTABLE')

        expect(() =>
            sqlite.prepare('DELETE FROM download_job_storage WHERE job_id=?').run(job.id)
        ).toThrow('DOWNLOAD_STORAGE_REQUIRED')

        const roots = new DownloadRootRepository(db)

        expect(() => roots.bind(job.id, rootB)).toThrow()
        expect(roots.bind(job.id, rootA)).toBe(rootA)

        db.delete(s.downloadQueue).where(eq(s.downloadQueue.id, job.id)).run()

        expect(sqlite.prepare('SELECT count(*) FROM download_job_storage').pluck().get()).toBe(0)
    })

    it('작업 생성과 루트 기록을 같은 트랜잭션에서 롤백한다', async () => {
        await upgrade()

        expect(() =>
            db.transaction((tx) => {
                const job = queued('rolled-back')

                new DownloadRootRepository(tx).bind(job.id, rootB)

                throw new Error('INJECTED')
            })
        ).toThrow('INJECTED')

        expect(db.select().from(s.downloadQueue).all()).toEqual([])

        expect(sqlite.prepare('SELECT count(*) FROM download_job_storage').pluck().get()).toBe(0)
    })

    it('버전 3의 스키마 변형과 경로 기록 누락을 재실행에서 감지한다', async () => {
        const job = queued('old')
        await upgrade()

        const trigger = sqlite
            .prepare("SELECT sql FROM sqlite_master WHERE name='download_storage_required'")
            .pluck()
            .get() as string

        sqlite.exec('DROP TRIGGER download_storage_required')

        await expect(upgrade()).rejects.toThrow('DOWNLOAD_STORAGE_SCHEMA_MISMATCH')

        sqlite.prepare('DELETE FROM download_job_storage WHERE job_id=?').run(job.id)

        sqlite.exec(trigger)

        await expect(upgrade()).rejects.toThrow('DOWNLOAD_STORAGE_BINDING_MISSING')
    })

    it('새 DB도 기존 이관부터 순서대로 적용하고 이전 목표로 열지 않는다', async () => {
        const fresh = new Database(':memory:')
        fresh.pragma('foreign_keys = ON')

        try {
            const result = await migrateDatabase(fresh, {
                ...input({ legacyStorageRoot: undefined }),
                targetVersion: 3
            })

            expect(result.version).toBe(3)

            expect(fresh.pragma('user_version', { simple: true })).toBe(3)

            await expect(
                migrateDatabase(fresh, {
                    ...input(),
                    targetVersion: 2
                })
            ).rejects.toThrow('UNSUPPORTED_DATABASE_VERSION')
        } finally {
            fresh.close()
        }
    })
})
