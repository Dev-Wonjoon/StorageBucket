import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    migrateDatabase,
    legacyNumericTimeUnit,
    migrateLegacyDatabase,
    migrateToVersion2,
    type Version2MigrationOptions
} from '../../src/database/migrate'
import { schemaV2Sql } from '../../src/database/schema-v2.sql'

describe('기존 SQL 마이그레이션', () => {
    const migrations = readMigrationFiles({
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url))
    })

    let sqlite: Database.Database

    const backup = vi.fn(async () => 'synthetic-backup')

    const options = {
        backupDirectory: 'unused',
        createBackup: backup
    }

    function nextMigration(sql: string[]): MigrationMeta {
        return {
            sql,
            hash: createHash('sha256').update(sql.join('\n')).digest('hex'),
            folderMillis: migrations.at(-1)!.folderMillis + 1,
            bps: true
        }
    }

    beforeEach(() => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')
        backup.mockClear()
    })

    afterEach(() => {
        if (sqlite.open) sqlite.close()
    })

    it('기존 마이그레이션을 한 번만 적용한다', async () => {
        await migrateLegacyDatabase(sqlite, migrations, options)

        await migrateLegacyDatabase(sqlite, migrations, options)

        expect(sqlite.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBe(
            migrations.length
        )

        expect(backup).not.toHaveBeenCalled()

        expect(sqlite.pragma('foreign_key_check')).toEqual([])
    })

    it('실패하면 스키마·데이터·이력을 함께 롤백한다', async () => {
        await migrateLegacyDatabase(sqlite, migrations, options)

        sqlite
            .prepare(
                `
      INSERT INTO media(
        title,
        filepath,
        created_at
      )
      VALUES (?, ?, ?)
    `
            )
            .run('keep', 'C:/fixture/one.png', 1700000000)

        const failing = nextMigration([
            'CREATE TABLE transient_result(id INTEGER)',
            "UPDATE media SET title = 'changed'",
            'INSERT INTO missing_table VALUES (1)'
        ])

        await expect(
            migrateLegacyDatabase(sqlite, [...migrations, failing], options)
        ).rejects.toThrow()

        expect(backup).toHaveBeenCalledTimes(1)

        expect(sqlite.prepare('SELECT title FROM media').pluck().get()).toBe('keep')

        expect(
            sqlite
                .prepare(
                    `
        SELECT name
        FROM sqlite_master
        WHERE name = 'transient_result'
      `
                )
                .get()
        ).toBeUndefined()

        expect(sqlite.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBe(
            migrations.length
        )
    })

    it('변조된 마이그레이션은 백업 전에 거부한다', async () => {
        await migrateLegacyDatabase(sqlite, migrations, options)

        const altered = migrations.map((item, index) =>
            index === 0
                ? {
                      ...item,
                      hash: '0'.repeat(64)
                  }
                : item
        )

        await expect(migrateLegacyDatabase(sqlite, altered, options)).rejects.toThrow('일치')

        expect(backup).not.toHaveBeenCalled()
    })

    it('새로운 DB를 이전 마이그레이션으로 열지 않는다', async () => {
        await migrateLegacyDatabase(sqlite, migrations, options)

        await expect(
            migrateLegacyDatabase(sqlite, migrations.slice(0, -1), options)
        ).rejects.toThrow('새로운 DB')

        expect(backup).not.toHaveBeenCalled()
    })

    it('잘못된 외래키 참조를 커밋하지 않는다', async () => {
        await migrateLegacyDatabase(sqlite, migrations, options)

        const invalid = nextMigration([
            'INSERT INTO media_tag(media_id, tag_id) VALUES (99999, 99999)'
        ])

        await expect(
            migrateLegacyDatabase(sqlite, [...migrations, invalid], options)
        ).rejects.toThrow()

        expect(sqlite.prepare('SELECT count(*) FROM media_tag').pluck().get()).toBe(0)
    })

    it('이력이 없는 기존 DB는 적용을 보류한다', async () => {
        sqlite.exec('CREATE TABLE user_data(id INTEGER)')

        await expect(migrateLegacyDatabase(sqlite, migrations, options)).rejects.toThrow('이력')

        expect(backup).not.toHaveBeenCalled()
    })
})

describe('새 구조 이관과 통합 진입점', () => {
    const legacyMigrations = readMigrationFiles({
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url))
    })

    const schemaSql = [...schemaV2Sql]
    let sqlite: Database.Database
    let backups: number
    let backupCopies: Database.Database[]

    beforeEach(async () => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')

        backups = 0
        backupCopies = []

        await migrateLegacyDatabase(sqlite, legacyMigrations, {
            backupDirectory: 'unused'
        })

        sqlite.exec(`
      INSERT INTO platform(id,name)
      VALUES (7,'sample');

      INSERT INTO profiles(
        id,
        owner_id,
        owner_name,
        platform_id,
        updated_at
      )
      VALUES (9,'u','업로더',7,1700000000);

      INSERT INTO download_urls(
        id,
        url,
        video_id,
        created_at
      )
      VALUES (
        13,
        'https://example.invalid/post/1?img_index=2',
        'old-id',
        1700000000
      );

      INSERT INTO download_urls(
        id,
        url,
        created_at
      )
      VALUES (
        99,
        'https://example.invalid/deleted',
        1700000000
      );

      DELETE FROM download_urls WHERE id=99;

      INSERT INTO media(
        id,
        title,
        filepath,
        thumbnail_path,
        url_id,
        platform_id,
        profile_id,
        created_at,
        updated_at
      )
      VALUES (
        42,
        '사용자 제목',
        'C:/fixture/a.png',
        'C:/fixture/a.png',
        13,
        7,
        9,
        1700000000,
        NULL
      );

      INSERT INTO media(
        id,
        title,
        filepath,
        created_at
      )
      VALUES (
        900,
        'deleted',
        'C:/fixture/deleted',
        1700000000
      );

      DELETE FROM media WHERE id=900;

      INSERT INTO tag(id,name,updated_at)
      VALUES (4,'태그',NULL);

      INSERT INTO media_tag(media_id,tag_id)
      VALUES (42,4);

      INSERT INTO favorite(id,media_id,created_at)
      VALUES (6,42,1700000000);
    `)

        sqlite
            .prepare(
                `
      INSERT INTO download_queue (
        id,
        url,
        status,
        options,
        progress,
        created_at,
        updated_at,
        title,
        thumbnail,
        error_message,
        log,
        started_at,
        finished_at
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `
            )
            .run(
                'old-job',
                'https://example.invalid/list?list=a',
                'downloading',
                JSON.stringify(JSON.stringify({ quality: '1080' })),
                37,
                '2026-10-23 10:00:00',
                1700000000,
                '작업 제목',
                'old-thumb',
                'old-error',
                'old-log',
                1700000000000,
                null
            )
    })

    afterEach(() => {
        for (const copy of backupCopies) {
            if (copy.open) copy.close()
        }

        if (sqlite.open) sqlite.close()
    })

    function backup(source: Database.Database) {
        backups++

        const connection = new Database(source.serialize())

        backupCopies.push(connection)

        return Promise.resolve({
            path: 'memory-backup',
            connection
        })
    }

    function input(extra: Partial<Version2MigrationOptions> = {}): Version2MigrationOptions {
        return {
            legacyMigrations,
            schemaSql,
            backupDirectory: 'unused',
            backup,

            // 위 합성 데이터의 저장 단위를 명시한다.
            numericTimeUnit: (_table, column) =>
                column === 'started_at' || column === 'finished_at' ? 'milliseconds' : 'seconds',

            ...extra
        }
    }

    function get(sql: string) {
        return sqlite.prepare(sql).get() as Record<string, unknown>
    }

    describe('버전 2 이관', () => {
        it('실제 앱 날짜 정책으로 확인된 초 단위를 변환한다', async () => {
            sqlite.exec(`
                UPDATE download_queue
                SET started_at = NULL, finished_at = NULL
            `)

            const result = await migrateDatabase(sqlite, {
                ...input(),
                targetVersion: 2,
                numericTimeUnit: legacyNumericTimeUnit
            })

            expect(result.version).toBe(2)

            expect(get('SELECT created_at FROM media WHERE id=42').created_at).toBe(1700000000000)

            expect(get('SELECT updated_at FROM profiles WHERE id=9').updated_at).toBe(1700000000000)

            expect(get('SELECT created_at FROM favorite WHERE id=6').created_at).toBe(1700000000000)

            expect(
                get(`
                    SELECT created_at FROM download_queue
                    WHERE id='old-job'
                `).created_at
            ).toBe(Date.parse('2026-10-23T10:00:00Z'))
        })

        it('작성 단위가 확인되지 않은 큐 숫자 시각은 원본을 보존하고 보류한다', async () => {
            await expect(
                migrateDatabase(sqlite, {
                    ...input(),
                    targetVersion: 2,
                    numericTimeUnit: legacyNumericTimeUnit
                })
            ).rejects.toThrow('UNCONFIRMED_LEGACY_TIMESTAMP_UNIT: download_queue.started_at')

            expect(sqlite.pragma('user_version', { simple: true })).toBe(0)

            expect(get('SELECT title FROM media WHERE id=42').title).toBe('사용자 제목')

            expect(backups).toBe(0)
            expect(sqlite.pragma('foreign_key_check')).toEqual([])
        })

        it('ID·경로·관계·원문·작업 정보를 보존한다', async () => {
            const result = await migrateToVersion2(sqlite, input())

            expect(result.migrated).toBe(true)
            expect(result.maintenancePending).toBe(false)
            expect(backups).toBe(1)

            expect(get('SELECT * FROM media')).toMatchObject({
                id: 42,
                source_kind: 'legacy',
                source_title: '사용자 제목',
                custom_title: '사용자 제목',
                request_url_id: null,
                created_at: 1700000000000,
                updated_at: null
            })

            expect(get('SELECT * FROM media_file')).toMatchObject({
                media_id: 42,
                storage_kind: 'unverified_legacy',
                filepath: 'C:/fixture/a.png',
                thumbnail_path: 'C:/fixture/a.png',
                thumbnail_origin: 'unverified_legacy',
                legacy_url_id: 13,
                external_id: null
            })

            expect(get('SELECT * FROM download_queue')).toMatchObject({
                id: 'old-job',
                state: 'interrupted',
                progress: 37,
                title: '작업 제목',
                thumbnail: 'old-thumb',
                log: 'old-log',
                error_message: 'old-error',
                recovery_enabled: 0,
                auto_history_unknown: 1,
                auto_run_count: null,
                created_at: Date.parse('2026-10-23T10:00:00Z'),
                started_at: 1700000000000,
                finished_at: null
            })

            expect(
                JSON.parse(String(get('SELECT options_json FROM download_queue').options_json))
            ).toEqual({
                quality: '1080'
            })

            expect(get('SELECT * FROM media_tag')).toMatchObject({
                media_id: 42,
                tag_id: 4
            })

            expect(get('SELECT * FROM favorite')).toMatchObject({
                id: 6,
                media_id: 42
            })

            expect(
                JSON.parse(
                    String(
                        get(`
            SELECT payload_json
            FROM legacy_record
            WHERE table_name = 'media'
          `).payload_json
                    )
                )
            ).toMatchObject({
                title: '사용자 제목',
                updated_at: null
            })

            expect(
                get(`
          SELECT count(*) AS n
          FROM __drizzle_migrations
        `).n
            ).toBe(7)

            expect(get('SELECT count(*) AS n FROM media_fts').n).toBe(1)

            expect(sqlite.pragma('foreign_key_check')).toEqual([])

            expect(backupCopies.every((copy) => !copy.open)).toBe(true)
        })

        it('최고 ID를 보존하고 이관을 반복하지 않는다', async () => {
            await migrateToVersion2(sqlite, input())

            expect((await migrateToVersion2(sqlite, input())).migrated).toBe(false)

            expect(backups).toBe(1)

            const id = sqlite
                .prepare(
                    `
        INSERT INTO media(
          source_kind,
          created_at,
          updated_at
        )
        VALUES ('legacy',1,1)
      `
                )
                .run().lastInsertRowid

            expect(id).toBe(901)
        })

        it('정규화 URL 충돌은 백업 전에 차단한다', async () => {
            sqlite
                .prepare(
                    `
        INSERT INTO download_urls(
          url,
          created_at
        )
        VALUES (?,?)
      `
                )
                .run('https://EXAMPLE.invalid:443/post/1?img_index=2', 1700000000)

            await expect(migrateToVersion2(sqlite, input())).rejects.toThrow(
                'URL_NORMALIZATION_COLLISION'
            )

            expect(backups).toBe(0)
        })

        it('같은 URL의 기존 부모가 여러 개면 보류한다', async () => {
            sqlite.exec(`
        INSERT INTO media(
          id,
          title,
          filepath,
          url_id,
          created_at
        )
        VALUES (
          43,
          'other',
          'C:/fixture/b',
          13,
          1700000000
        )
      `)

            await expect(migrateToVersion2(sqlite, input())).rejects.toThrow('URL_PARENT_COLLISION')

            expect(backups).toBe(0)
        })

        it('알 수 없는 스키마 변경을 차단한다', async () => {
            sqlite.exec('ALTER TABLE media ADD unknown_column TEXT')

            await expect(migrateToVersion2(sqlite, input())).rejects.toThrow('LEGACY_SCHEMA')

            expect(backups).toBe(0)
        })

        it('해석 불가 옵션과 잘못된 날짜를 차단한다', async () => {
            sqlite.exec("UPDATE download_queue SET options='broken'")

            await expect(migrateToVersion2(sqlite, input())).rejects.toThrow()

            sqlite.exec(`
        UPDATE download_queue
        SET
          options='{}',
          created_at='2026-02-30 10:00:00'
      `)

            await expect(migrateToVersion2(sqlite, input())).rejects.toThrow('INVALID_TIMESTAMP')

            expect(backups).toBe(0)
        })

        it('백업 실패 시 원본을 변경하지 않는다', async () => {
            await expect(
                migrateToVersion2(
                    sqlite,
                    input({
                        backup: async () => {
                            throw new Error('BACKUP_FAILED')
                        }
                    })
                )
            ).rejects.toThrow('BACKUP_FAILED')

            expect(get('SELECT title FROM media').title).toBe('사용자 제목')

            expect(
                sqlite.pragma('user_version', {
                    simple: true
                })
            ).toBe(0)
        })

        it('내용이 다른 백업을 거부한다', async () => {
            await expect(
                migrateToVersion2(
                    sqlite,
                    input({
                        backup: async (source) => {
                            const copy = await backup(source)

                            copy.connection.exec('DELETE FROM media_tag')

                            return copy
                        }
                    })
                )
            ).rejects.toThrow('BACKUP_MISMATCH')

            expect(get('SELECT count(*) AS n FROM media_tag').n).toBe(1)
        })

        it('백업 대기 중 발생한 원본 편집을 보존한다', async () => {
            await expect(
                migrateToVersion2(
                    sqlite,
                    input({
                        backup: async (source) => {
                            const copy = await backup(source)

                            source.exec("UPDATE media SET title='new edit'")

                            return copy
                        }
                    })
                )
            ).rejects.toThrow('SOURCE_CHANGED')

            expect(get('SELECT title FROM media').title).toBe('new edit')
        })

        for (const stage of ['after_drop', 'after_copy', 'before_commit'] as const) {
            it(stage + ' 실패 시 DDL과 데이터를 롤백한다', async () => {
                await expect(
                    migrateToVersion2(
                        sqlite,
                        input({
                            checkpoint: (current) => {
                                if (current === stage) {
                                    throw new Error('INJECTED')
                                }
                            }
                        })
                    )
                ).rejects.toThrow('INJECTED')

                expect(get('SELECT title FROM media').title).toBe('사용자 제목')

                expect(
                    get(`
              SELECT count(*) AS n
              FROM __drizzle_migrations
            `).n
                ).toBe(7)

                expect(sqlite.pragma('user_version', { simple: true })).toBe(0)

                expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
            })
        }

        it('검색 인덱스 실패로 이관 데이터를 되돌리지 않는다', async () => {
            const result = await migrateToVersion2(
                sqlite,
                input({
                    rebuildSearch: () => {
                        throw new Error('FTS_FAILED')
                    }
                })
            )

            expect(result.migrated).toBe(true)
            expect(result.maintenancePending).toBe(true)

            expect(
                sqlite.pragma('user_version', {
                    simple: true
                })
            ).toBe(2)

            expect(get('SELECT custom_title FROM media').custom_title).toBe('사용자 제목')

            expect(get('SELECT state FROM maintenance_task').state).toBe('pending')

            expect(get('SELECT last_error FROM maintenance_task').last_error).toBe('FTS_FAILED')
        })

        it('기존 FTS를 처리하고 이전 실행기의 재접근을 막는다', async () => {
            sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS media_fts
        USING fts5(
          title,
          owner_name,
          url,
          tag_names
        );
      `)

            await migrateToVersion2(sqlite, input())

            await expect(
                migrateLegacyDatabase(sqlite, legacyMigrations, {
                    backupDirectory: 'unused'
                })
            ).rejects.toThrow('LEGACY_RUNNER')
        })
    })

    describe('통합 마이그레이션 진입점', () => {
        it('목표 버전 0에서는 현재 기존 스키마를 유지한다', async () => {
            const result = await migrateDatabase(sqlite, {
                targetVersion: 0,
                legacyMigrations,
                backupDirectory: 'unused'
            })

            expect(result.version).toBe(0)
            expect(result.backupPath).toBeNull()

            expect(
                sqlite.pragma('user_version', {
                    simple: true
                })
            ).toBe(0)

            expect(get('SELECT title FROM media WHERE id=42').title).toBe('사용자 제목')

            expect(
                sqlite
                    .prepare(
                        `
          SELECT 1
          FROM sqlite_master
          WHERE name='media_file'
        `
                    )
                    .get()
            ).toBeUndefined()

            expect(backups).toBe(0)
        })

        it('목표 버전 2로 이관한 뒤 재시작에서는 기존 실행기를 건너뛴다', async () => {
            const first = await migrateDatabase(sqlite, {
                ...input(),
                targetVersion: 2
            })

            expect(first.version).toBe(2)

            if (first.version !== 2) {
                throw new Error('Expected version 2')
            }

            expect(first.migrated).toBe(true)
            expect(first.legacyBackupPath).toBeNull()

            const again = await migrateDatabase(sqlite, {
                ...input(),
                targetVersion: 2
            })

            if (again.version !== 2) {
                throw new Error('Expected version 2')
            }

            expect(again.migrated).toBe(false)
            expect(again.backupPath).toBe('memory-backup')
            expect(backups).toBe(1)
        })

        it('버전 2 DB에 기존 스키마 목표를 지정하면 거부한다', async () => {
            await migrateDatabase(sqlite, {
                ...input(),
                targetVersion: 2
            })

            await expect(
                migrateDatabase(sqlite, {
                    targetVersion: 0,
                    legacyMigrations,
                    backupDirectory: 'unused'
                })
            ).rejects.toThrow('LEGACY_RUNNER')
        })

        it('0006 이전 DB의 기존 이력을 완성하고 두 단계 백업을 구분한다', async () => {
            const older = new Database(':memory:')
            older.pragma('foreign_keys = ON')

            let legacyBackups = 0

            try {
                await migrateLegacyDatabase(older, legacyMigrations.slice(0, 6), {
                    backupDirectory: 'unused'
                })

                const result = await migrateDatabase(older, {
                    ...input(),
                    targetVersion: 2,
                    legacyBackup: async () => {
                        legacyBackups++
                        return 'memory-legacy-backup'
                    }
                })

                if (result.version !== 2) {
                    throw new Error('Expected version 2')
                }

                expect(result.migrated).toBe(true)

                expect(result.legacyBackupPath).toBe('memory-legacy-backup')

                expect(result.backupPath).toBe('memory-backup')

                expect(legacyBackups).toBe(1)

                expect(
                    older.pragma('user_version', {
                        simple: true
                    })
                ).toBe(2)

                expect(older.pragma('foreign_key_check')).toEqual([])
            } finally {
                older.close()
            }
        })

        it('알 수 없는 DB 버전은 백업과 변경 전에 거부한다', async () => {
            sqlite.pragma('user_version = 3')

            await expect(
                migrateDatabase(sqlite, {
                    ...input(),
                    targetVersion: 2
                })
            ).rejects.toThrow('UNSUPPORTED_DATABASE_VERSION')

            expect(get('SELECT title FROM media WHERE id=42').title).toBe('사용자 제목')

            expect(backups).toBe(0)
        })

        it('기존 이력 목록에 새 단계를 섞으면 적용 전에 거부한다', async () => {
            await expect(
                migrateDatabase(sqlite, {
                    ...input(),
                    targetVersion: 2,
                    legacyMigrations: [...legacyMigrations, legacyMigrations[6]]
                })
            ).rejects.toThrow('UNSUPPORTED_LEGACY_MIGRATION_SET')

            expect(
                sqlite.pragma('user_version', {
                    simple: true
                })
            ).toBe(0)

            expect(backups).toBe(0)
        })

        it('통합 진입점에서도 이관 실패는 원본과 버전을 보존한다', async () => {
            await expect(
                migrateDatabase(sqlite, {
                    ...input({
                        checkpoint(stage) {
                            if (stage === 'before_commit') {
                                throw new Error('INJECTED')
                            }
                        }
                    }),
                    targetVersion: 2
                })
            ).rejects.toThrow('INJECTED')

            expect(get('SELECT title FROM media WHERE id=42').title).toBe('사용자 제목')

            expect(
                sqlite.pragma('user_version', {
                    simple: true
                })
            ).toBe(0)

            expect(
                sqlite.pragma('foreign_keys', {
                    simple: true
                })
            ).toBe(1)
        })

        it('검색 인덱스 실패는 이관 완료와 유지보수 필요로 반환한다', async () => {
            const result = await migrateDatabase(sqlite, {
                ...input({
                    rebuildSearch() {
                        throw new Error('FTS_FAILED')
                    }
                }),
                targetVersion: 2
            })

            if (result.version !== 2) {
                throw new Error('Expected version 2')
            }

            expect(result.migrated).toBe(true)

            expect(result.maintenancePending).toBe(true)

            expect(
                sqlite.pragma('user_version', {
                    simple: true
                })
            ).toBe(2)
        })
    })
})

describe('실제 앱의 기존 숫자 시각 정책', () => {
    it('확인된 열만 초 단위로 해석하고 다른 열은 거부한다', () => {
        const columns = [
            ['profiles', 'updated_at'],
            ['download_urls', 'created_at'],
            ['media', 'created_at'],
            ['media', 'updated_at'],
            ['tag', 'updated_at'],
            ['favorite', 'created_at'],
            ['download_queue', 'created_at'],
            ['download_queue', 'updated_at']
        ]

        for (const [table, column] of columns) {
            expect(legacyNumericTimeUnit(table, column)).toBe('seconds')
        }

        for (const column of ['started_at', 'finished_at', 'unknown']) {
            expect(() => legacyNumericTimeUnit('download_queue', column)).toThrow(
                'UNCONFIRMED_LEGACY_TIMESTAMP_UNIT'
            )
        }
    })
})
