import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { MigrationMeta } from 'drizzle-orm/migrator'
import { schemaV2Guards } from './schema-v2.guards'

type AppliedMigration = {
    hash: string
    created_at: number
}

type Backup = (sqlite: Database.Database, directory: string) => Promise<string>

type Row = Record<string, unknown>

type Unit = 'seconds' | 'milliseconds'

type BackupResult = {
    path: string
    connection: Database.Database
}

export interface Version2MigrationOptions {
    legacyMigrations: MigrationMeta[]
    schemaSql: string[]
    backupDirectory: string

    // 숫자 크기로 추측하지 않고 호출부에서 단위를 명시한다.
    numericTimeUnit: (table: string, column: string) => Unit

    backup?: (source: Database.Database) => Promise<BackupResult>

    rebuildSearch?: (sqlite: Database.Database) => void

    // 테스트·진단용. 실제 호출부에서는 생략한다.
    checkpoint?: (stage: 'after_drop' | 'after_copy' | 'before_commit') => void
}

export type DatabaseMigrationOptions =
    | {
          targetVersion: 0
          legacyMigrations: MigrationMeta[]
          backupDirectory: string
          legacyBackup?: Backup
      }
    | (Version2MigrationOptions & {
          targetVersion: 2
          legacyBackup?: Backup
      })
    | (Version3MigrationOptions & {
          targetVersion: 3
          legacyBackup?: Backup
      })

export type DatabaseMigrationResult =
    | {
          version: 0
          backupPath: string | null
      }
    | (Awaited<ReturnType<typeof migrateToVersion2>> & {
          version: 2
          legacyBackupPath: string | null
      })
    | (Awaited<ReturnType<typeof migrateDownloadStorage>> & {
          version: 3
          legacyBackupPath: string | null
          version2BackupPath: string | null
      })

const legacyTables = [
    'platform',
    'profiles',
    'download_urls',
    'media',
    'tag',
    'media_tag',
    'favorite',
    'download_queue'
] as const

const historySql = `
  CREATE TABLE __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )
`

const ftsSql = `
  CREATE VIRTUAL TABLE media_fts
  USING fts5(title, owner_name, url, tag_names)
`

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'

function assertHealthy(sqlite: Database.Database): void {
    if (
        sqlite.pragma('integrity_check', {
            simple: true
        }) !== 'ok'
    ) {
        throw new Error('DB 무결성 검사에 실패했습니다.')
    }

    if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) {
        throw new Error('DB 외래키 관계가 손상되어 있습니다.')
    }
}

export async function createBackup(sqlite: Database.Database, directory: string): Promise<string> {
    mkdirSync(directory, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

    const filename = join(directory, `storagebucket.pre-migration.${timestamp}.${randomUUID()}.db`)

    // 이번 실행이 배타적으로 예약한 새 파일만 사용한다.
    closeSync(openSync(filename, 'wx'))

    try {
        await sqlite.backup(filename)

        const backup = new Database(filename, {
            readonly: true,
            fileMustExist: true
        })

        try {
            assertHealthy(backup)
        } finally {
            backup.close()
        }

        return filename
    } catch (error) {
        // 완료되지 않은 이번 백업만 정리한다.
        try {
            unlinkSync(filename)
        } catch {
            // 원래 오류를 유지한다.
        }

        throw error
    }
}

export async function migrateLegacyDatabase(
    sqlite: Database.Database,
    migrations: MigrationMeta[],
    options: {
        backupDirectory: string
        createBackup?: Backup
    }
): Promise<string | null> {
    if (
        sqlite.pragma('user_version', {
            simple: true
        }) !== 0
    ) {
        throw new Error('LEGACY_RUNNER_REFUSES_VERSIONED_DATABASE')
    }

    if (sqlite.inTransaction) {
        throw new Error('마이그레이션은 기존 트랜잭션 밖에서 시작해야 합니다.')
    }

    if (
        sqlite.pragma('foreign_keys', {
            simple: true
        }) !== 1
    ) {
        throw new Error('foreign_keys를 먼저 활성화해야 합니다.')
    }

    const dataVersion = sqlite.pragma('data_version', { simple: true })

    assertHealthy(sqlite)

    for (let index = 0; index < migrations.length; index++) {
        const migration = migrations[index]

        if (
            !Number.isSafeInteger(migration.folderMillis) ||
            !/^[a-f0-9]{64}$/.test(migration.hash) ||
            (index > 0 && migrations[index - 1].folderMillis >= migration.folderMillis)
        ) {
            throw new Error('마이그레이션 파일 순서 또는 해시가 올바르지 않습니다.')
        }
    }

    const tables = sqlite
        .prepare(
            `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `
        )
        .all() as { name: string }[]

    const hasHistory = tables.some((row) => row.name === '__drizzle_migrations')

    const applied = hasHistory
        ? (sqlite
              .prepare(
                  `
        SELECT hash, created_at
        FROM __drizzle_migrations
        ORDER BY created_at
      `
              )
              .all() as AppliedMigration[])
        : []

    if (tables.some((row) => row.name !== '__drizzle_migrations') && applied.length === 0) {
        throw new Error('기존 테이블의 마이그레이션 이력을 확인할 수 없습니다.')
    }

    if (applied.length > migrations.length) {
        throw new Error('현재 앱보다 새로운 DB입니다. 이전 버전으로 열 수 없습니다.')
    }

    for (let index = 0; index < applied.length; index++) {
        if (
            applied[index].hash !== migrations[index].hash ||
            Number(applied[index].created_at) !== migrations[index].folderMillis
        ) {
            throw new Error('DB 이력과 배포된 마이그레이션 파일이 일치하지 않습니다.')
        }
    }

    const pending = migrations.slice(applied.length)

    if (pending.length === 0) {
        return null
    }

    const backupPath =
        tables.length > 0
            ? await (options.createBackup ?? createBackup)(sqlite, options.backupDirectory)
            : null

    sqlite
        .transaction(() => {
            // 백업을 기다리는 동안 다른 연결이 변경했다면 보류한다.
            if (
                sqlite.pragma('data_version', {
                    simple: true
                }) !== dataVersion
            ) {
                throw new Error('검사 또는 백업 중 DB가 변경되었습니다. 앱을 다시 시작하세요.')
            }

            sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `)

            const record = sqlite.prepare(`
      INSERT INTO __drizzle_migrations (
        hash,
        created_at
      )
      VALUES (?, ?)
    `)

            for (const migration of pending) {
                for (const statement of migration.sql) {
                    sqlite.exec(statement)
                }

                record.run(migration.hash, migration.folderMillis)
            }

            assertHealthy(sqlite)
        })
        .immediate()

    return backupPath
}

function encode(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (typeof item !== 'bigint') {
            return item
        }

        const result = Number(item)

        return Number.isSafeInteger(result) ? result : { sqliteInteger: String(item) }
    })
}

function digest(value: unknown): string {
    return createHash('sha256').update(encode(value)).digest('hex')
}

function rows(sqlite: Database.Database, query: string): Row[] {
    return sqlite.prepare(query).safeIntegers(true).all() as Row[]
}

function number(value: unknown): number {
    const result = typeof value === 'bigint' ? Number(value) : value

    if (typeof result !== 'number' || !Number.isSafeInteger(result)) {
        throw new Error('UNSUPPORTED_INTEGER')
    }

    return result
}

function healthy(sqlite: Database.Database): void {
    if (
        sqlite.pragma('integrity_check', {
            simple: true
        }) !== 'ok' ||
        (sqlite.pragma('foreign_key_check') as unknown[]).length
    ) {
        throw new Error('DATABASE_INTEGRITY_FAILED')
    }
}

function sqlTokens(value: unknown): string {
    const tokens =
        String(value ?? '').match(
            /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9]*|\d+|[^\s]/g
        ) ?? []

    return tokens
        .filter((token) => !token.startsWith('--') && !token.startsWith('/*'))
        .map((token) => (/^['"`\[]/.test(token) ? token : token.toLowerCase()))
        .join(' ')
}

function schemaSignature(sqlite: Database.Database): string {
    return digest(
        rows(
            sqlite,
            `
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `
        ).map((row) => ({
            ...row,
            sql: sqlTokens(row.sql)
        }))
    )
}

function hasFts(sqlite: Database.Database): boolean {
    return !!sqlite
        .prepare(
            `
    SELECT 1
    FROM sqlite_master
    WHERE name = 'media_fts'
      AND type = 'table'
  `
        )
        .get()
}

function snapshot(sqlite: Database.Database) {
    const data = Object.fromEntries(
        legacyTables.map((table) => [
            table,
            rows(
                sqlite,
                'SELECT * FROM ' +
                    quote(table) +
                    (table === 'media_tag' ? ' ORDER BY media_id, tag_id' : ' ORDER BY id')
            )
        ])
    ) as Record<(typeof legacyTables)[number], Row[]>

    for (const values of Object.values(data)) {
        for (const row of values) {
            for (const value of Object.values(row)) {
                if (typeof value === 'bigint' || typeof value === 'number') {
                    number(value)
                } else if (value !== null && typeof value !== 'string') {
                    throw new Error('UNSUPPORTED_LEGACY_VALUE')
                }
            }
        }
    }

    return {
        schema: schemaSignature(sqlite),
        version: sqlite.pragma('user_version', {
            simple: true
        }),
        data,
        history: rows(
            sqlite,
            `
      SELECT *
      FROM __drizzle_migrations
      ORDER BY created_at, hash
    `
        ),
        sequence: rows(
            sqlite,
            `
      SELECT name, seq
      FROM sqlite_sequence
      ORDER BY name
    `
        )
    }
}

type Snapshot = ReturnType<typeof snapshot>

function insert(sqlite: Database.Database, table: string, row: Row): void {
    const names = Object.keys(row)

    sqlite
        .prepare(
            'INSERT INTO ' +
                quote(table) +
                ' (' +
                names.map(quote).join(',') +
                ')' +
                ' VALUES (' +
                names.map(() => '?').join(',') +
                ')'
        )
        .run(...Object.values(row))
}

function time(
    value: unknown,
    table: string,
    column: string,
    unit: Version2MigrationOptions['numericTimeUnit']
): number | null {
    if (value === null) {
        return null
    }

    let result: number

    if (typeof value === 'string') {
        const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z?$/.exec(value)

        if (!match) {
            throw new Error('UNSUPPORTED_TIMESTAMP: ' + table + '.' + column)
        }

        const normalized = match[1] + 'T' + match[2] + '.' + (match[3] ?? '').padEnd(3, '0') + 'Z'

        result = Date.parse(normalized)

        if (!Number.isFinite(result) || new Date(result).toISOString() !== normalized) {
            throw new Error('INVALID_TIMESTAMP: ' + table + '.' + column)
        }
    } else {
        const sourceUnit = unit(table, column)

        if (sourceUnit !== 'seconds' && sourceUnit !== 'milliseconds') {
            throw new Error('TIMESTAMP_UNIT_REQUIRED: ' + table + '.' + column)
        }

        result = number(value) * (sourceUnit === 'seconds' ? 1000 : 1)
    }

    if (!Number.isSafeInteger(result) || Math.abs(result) > 8640000000000000) {
        throw new Error('TIMESTAMP_OUT_OF_RANGE')
    }

    return result
}

function normalizeUrl(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('INVALID_URL')
    }

    const url = new URL(value)

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('INVALID_URL')
    }

    // 콘텐츠 선택 파라미터와 fragment를 보존한다.
    return url.toString()
}

function optionsJson(value: unknown): string {
    let parsed = value

    for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth++) {
        parsed = JSON.parse(parsed)
    }

    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new Error('UNSUPPORTED_OPTIONS')
    }

    return encode(parsed)
}

function transform(source: Snapshot, unit: Version2MigrationOptions['numericTimeUnit']) {
    const converted: Record<string, Row[]> = {}

    for (const table of ['platform', 'profiles', 'tag', 'media_tag', 'favorite'] as const) {
        converted[table] = source.data[table].map((row) => {
            const next = { ...row }

            for (const column of ['created_at', 'updated_at']) {
                if (column in next) {
                    next[column] = time(next[column], table, column, unit)
                }
            }

            return next
        })
    }

    const urls = new Map<string, number>()

    converted.download_urls = source.data.download_urls.map((row) => {
        const normalized = normalizeUrl(row.url)

        if (urls.has(normalized)) {
            throw new Error('URL_NORMALIZATION_COLLISION')
        }

        const id = number(row.id)
        urls.set(normalized, id)

        return {
            id,
            url: row.url,
            normalized_url: normalized,
            normalization_version: 1,
            legacy_video_id: row.video_id,
            created_at: time(row.created_at, 'download_urls', 'created_at', unit)
        }
    })

    let nextUrlId = [
        ...source.data.download_urls.map((row) => row.id),
        ...source.sequence.filter((row) => row.name === 'download_urls').map((row) => row.seq)
    ].reduce<number>((maximum, value) => Math.max(maximum, number(value)), 0)

    const legacyUrls = new Map(source.data.download_urls.map((row) => [number(row.id), row.url]))

    const usedUrls = new Set<number>()

    converted.media = []
    converted.media_file = []

    for (const row of source.data.media) {
        const id = number(row.id)

        if (row.url_id !== null) {
            const urlId = number(row.url_id)

            if (usedUrls.has(urlId)) {
                throw new Error('URL_PARENT_COLLISION')
            }

            usedUrls.add(urlId)
        }

        const created = time(row.created_at, 'media', 'created_at', unit)

        converted.media.push({
            id,
            source_kind: 'legacy',
            request_url_id: null,
            source_title: row.title,
            custom_title: row.title,
            cover_mode: 'auto',
            revision: 0,
            created_at: created,
            updated_at: time(row.updated_at, 'media', 'updated_at', unit)
        })

        converted.media_file.push({
            id,
            media_id: id,
            file_key: 'legacy-media:' + id,
            storage_kind: 'unverified_legacy',
            legacy_url_id: row.url_id,
            source_url: row.url_id === null ? null : legacyUrls.get(number(row.url_id)),
            external_id: null,
            platform_id: row.platform_id,
            profile_id: row.profile_id,
            title: row.title,
            filepath: row.filepath,
            filesize: row.filesize,
            thumbnail_path: row.thumbnail_path,
            thumbnail_origin: row.thumbnail_path === null ? 'none' : 'unverified_legacy',
            kind: 'unknown',
            position: 0,
            created_at: created
        })
    }

    converted.download_queue = source.data.download_queue.map((row) => {
        const key = normalizeUrl(row.url)
        let urlId = urls.get(key)

        if (urlId === undefined) {
            urlId = ++nextUrlId

            if (!Number.isSafeInteger(urlId)) {
                throw new Error('URL_ID_OVERFLOW')
            }

            urls.set(key, urlId)

            converted.download_urls.push({
                id: urlId,
                url: row.url,
                normalized_url: key,
                normalization_version: 1,
                legacy_video_id: null,
                created_at: time(row.created_at, 'download_queue', 'created_at', unit) ?? Date.now()
            })
        }

        const state =
            row.status === 'pending' || row.status === 'downloading' ? 'interrupted' : row.status

        if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(String(state))) {
            throw new Error('UNSUPPORTED_QUEUE_STATE')
        }

        const result: Row = {
            id: row.id,
            request_url_id: urlId,
            original_url: row.url,
            mode: 'create',
            state,
            options_json: optionsJson(row.options),
            progress: number(row.progress),
            recovery_enabled: 0,
            auto_run_limit: 1,
            auto_run_count: null,
            auto_history_unknown: 1,
            cleanup_required: 0,
            title: row.title,
            thumbnail: row.thumbnail,
            error_message: row.error_message,
            log: row.log
        }

        for (const column of ['created_at', 'updated_at', 'started_at', 'finished_at']) {
            result[column] = time(row[column], 'download_queue', column, unit)
        }

        return result
    })

    converted.legacy_record = legacyTables.flatMap((table) =>
        source.data[table].map((row) => ({
            table_name: table,
            row_key: table === 'media_tag' ? encode([row.media_id, row.tag_id]) : String(row.id),
            payload_json: encode(row)
        }))
    )

    return converted
}

function copy(sqlite: Database.Database, data: Record<string, Row[]>, source: Snapshot): void {
    const order = [
        'platform',
        'profiles',
        'tag',
        'download_urls',
        'media',
        'media_file',
        'media_tag',
        'favorite',
        'download_queue',
        'legacy_record'
    ]

    for (const table of order) {
        for (const row of data[table]) {
            insert(sqlite, table, row)
        }
    }

    // 삭제된 ID도 재사용하지 않도록 기존 최고값을 보존한다.
    for (const row of source.sequence) {
        if (!legacyTables.includes(row.name as (typeof legacyTables)[number])) {
            continue
        }

        const name = String(row.name)

        const current = sqlite
            .prepare('SELECT seq FROM sqlite_sequence WHERE name = ?')
            .safeIntegers(true)
            .get(name) as Row | undefined

        const maximum = Math.max(number(row.seq), current ? number(current.seq) : 0)

        sqlite.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name)

        sqlite.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)').run(name, maximum)
    }

    const empty = sqlite
        .prepare(
            `
    SELECT id
    FROM media
    WHERE NOT EXISTS (
      SELECT 1
      FROM media_file f
      WHERE f.media_id = media.id
    )
  `
        )
        .get()

    if (empty) {
        throw new Error('EMPTY_MEDIA')
    }

    healthy(sqlite)
}

export function rebuildSearchIndex(sqlite: Database.Database): void {
    sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS media_fts
    USING fts5(title, owner_name, url, tag_names)
  `)

    sqlite.exec('DELETE FROM media_fts')

    sqlite.exec(`
    INSERT INTO media_fts(
      rowid,
      title,
      owner_name,
      url,
      tag_names
    )
    SELECT
      m.id,

      COALESCE(
        m.custom_title,
        m.source_title,
        ''
      ) || ' ' ||
      COALESCE((
        SELECT group_concat(f.title, ' ')
        FROM media_file f
        WHERE f.media_id = m.id
      ), ''),

      COALESCE((
        SELECT group_concat(p.owner_name, ' ')
        FROM media_file f
        JOIN profiles p ON p.id = f.profile_id
        WHERE f.media_id = m.id
      ), ''),

      COALESCE(u.url, '') || ' ' ||
      COALESCE((
        SELECT group_concat(f.source_url, ' ')
        FROM media_file f
        WHERE f.media_id = m.id
      ), ''),

      COALESCE((
        SELECT group_concat(t.name, ' ')
        FROM media_tag mt
        JOIN tag t ON t.id = mt.tag_id
        WHERE mt.media_id = m.id
      ), '')

    FROM media m
    LEFT JOIN download_urls u
      ON u.id = m.request_url_id
  `)
}

export async function migrateToVersion2(
    sqlite: Database.Database,
    input: Version2MigrationOptions
) {
    if (
        sqlite.inTransaction ||
        sqlite.pragma('foreign_keys', {
            simple: true
        }) !== 1
    ) {
        throw new Error('MIGRATION_REQUIRES_IDLE_CONNECTION_WITH_FOREIGN_KEYS')
    }

    const dataVersion = sqlite.pragma('data_version', { simple: true })

    healthy(sqlite)

    const schemaHash = digest([input.schemaSql, schemaV2Guards])

    const target = new Database(':memory:')
    target.pragma('foreign_keys = ON')

    try {
        for (const statement of input.schemaSql) {
            if (
                !/^\s*CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\b/i.test(statement) ||
                statement.replace(/;\s*$/, '').includes(';')
            ) {
                throw new Error('INVALID_SCHEMA_SQL')
            }

            target.exec(statement)
        }

        target.exec(historySql)

        for (const statement of schemaV2Guards) {
            target.exec(statement)
        }

        const version = sqlite.pragma('user_version', { simple: true })

        if (version === 2) {
            const marker = sqlite
                .prepare(
                    `
        SELECT schema_hash, backup_path
        FROM migration_run
        WHERE target_version = 2
      `
                )
                .get() as Row | undefined

            if (!marker || marker.schema_hash !== schemaHash) {
                throw new Error('V2_MARKER_MISMATCH')
            }

            if (hasFts(sqlite)) {
                target.exec(ftsSql)
            }

            if (schemaSignature(sqlite) !== schemaSignature(target)) {
                throw new Error('V2_SCHEMA_MISMATCH')
            }

            const pending = sqlite
                .prepare(
                    `
        SELECT 1
        FROM maintenance_task
        WHERE state <> 'completed'
        LIMIT 1
      `
                )
                .get()

            return {
                migrated: false,
                backupPath: marker.backup_path,
                maintenancePending: !!pending
            }
        }

        if (version !== 0 || input.legacyMigrations.length !== 7) {
            throw new Error('UNSUPPORTED_LEGACY_VERSION')
        }

        const expected = new Database(':memory:')

        try {
            expected.exec(historySql)

            for (const migration of input.legacyMigrations) {
                for (const statement of migration.sql) {
                    expected.exec(statement)
                }

                expected
                    .prepare(
                        `
          INSERT INTO __drizzle_migrations(
            hash,
            created_at
          )
          VALUES (?, ?)
        `
                    )
                    .run(migration.hash, migration.folderMillis)
            }

            if (hasFts(sqlite)) {
                expected.exec(ftsSql)
            }

            if (
                schemaSignature(sqlite) !== schemaSignature(expected) ||
                encode(
                    rows(
                        sqlite,
                        `
          SELECT *
          FROM __drizzle_migrations
          ORDER BY created_at, hash
        `
                    )
                ) !==
                    encode(
                        rows(
                            expected,
                            `
          SELECT *
          FROM __drizzle_migrations
          ORDER BY created_at, hash
        `
                        )
                    )
            ) {
                throw new Error('LEGACY_SCHEMA_OR_HISTORY_MISMATCH')
            }
        } finally {
            expected.close()
        }

        const source = snapshot(sqlite)
        const fingerprint = digest(source)

        const data = transform(source, input.numericTimeUnit)

        for (const row of source.history) {
            insert(target, '__drizzle_migrations', row)
        }

        // 백업 전에 새 구조에서 실제 삽입과 제약조건을 검사한다.
        copy(target, data, source)

        const backup = input.backup
            ? await input.backup(sqlite)
            : await (async () => {
                  const path = await createBackup(sqlite, input.backupDirectory)

                  return {
                      path,
                      connection: new Database(path, {
                          readonly: true,
                          fileMustExist: true
                      })
                  }
              })()

        try {
            healthy(backup.connection)

            if (digest(snapshot(backup.connection)) !== fingerprint) {
                throw new Error('BACKUP_MISMATCH')
            }
        } finally {
            backup.connection.close()
        }

        const maintenanceId = randomUUID()
        const now = Date.now()

        if (sqlite.inTransaction) {
            throw new Error('SOURCE_TRANSACTION_CHANGED')
        }

        sqlite.pragma('foreign_keys = OFF')

        if (
            sqlite.pragma('foreign_keys', {
                simple: true
            }) !== 0
        ) {
            throw new Error('FOREIGN_KEYS_DISABLE_FAILED')
        }

        try {
            sqlite
                .transaction(() => {
                    if (
                        sqlite.pragma('data_version', {
                            simple: true
                        }) !== dataVersion ||
                        digest(snapshot(sqlite)) !== fingerprint
                    ) {
                        throw new Error('SOURCE_CHANGED')
                    }

                    if (hasFts(sqlite)) {
                        sqlite.exec('DROP TABLE media_fts')
                    }

                    for (const table of legacyTables) {
                        sqlite.exec('DROP TABLE ' + quote(table))
                    }

                    input.checkpoint?.('after_drop')

                    for (const statement of input.schemaSql) {
                        sqlite.exec(statement)
                    }

                    copy(sqlite, data, source)

                    for (const statement of schemaV2Guards) {
                        sqlite.exec(statement)
                    }

                    input.checkpoint?.('after_copy')

                    insert(sqlite, 'maintenance_task', {
                        id: maintenanceId,
                        kind: 'search_reindex',
                        state: 'pending',
                        owner_kind: 'system',
                        payload_json: '{"scope":"all"}',
                        try_count: 0,
                        created_at: now,
                        updated_at: now
                    })

                    insert(sqlite, 'migration_run', {
                        id: randomUUID(),
                        target_version: 2,
                        source_fingerprint: fingerprint,
                        schema_hash: schemaHash,
                        backup_path: backup.path,
                        completed_at: now
                    })

                    sqlite.pragma('user_version = 2')

                    input.checkpoint?.('before_commit')

                    healthy(sqlite)
                })
                .immediate()
        } finally {
            sqlite.pragma('foreign_keys = ON')

            if (
                sqlite.pragma('foreign_keys', {
                    simple: true
                }) !== 1
            ) {
                throw new Error('FOREIGN_KEYS_REENABLE_FAILED')
            }
        }

        let maintenancePending = false

        try {
            sqlite
                .transaction(() => {
                    ;(input.rebuildSearch ?? rebuildSearchIndex)(sqlite)

                    sqlite
                        .prepare(
                            `
          UPDATE maintenance_task
          SET
            state = 'completed',
            updated_at = ?
          WHERE id = ?
        `
                        )
                        .run(Date.now(), maintenanceId)
                })
                .immediate()
        } catch (error) {
            maintenancePending = true

            try {
                sqlite
                    .prepare(
                        `
          UPDATE maintenance_task
          SET
            last_error = ?,
            updated_at = ?
          WHERE id = ?
        `
                    )
                    .run(
                        error instanceof Error ? error.message : String(error),
                        Date.now(),
                        maintenanceId
                    )
            } catch {
                // pending 기록은 이관 커밋에 이미 포함되어 있다.
            }
        }

        return {
            migrated: true,
            backupPath: backup.path,
            maintenancePending
        }
    } finally {
        target.close()
    }
}

export async function migrateDatabase(
    sqlite: Database.Database,
    options: DatabaseMigrationOptions
): Promise<DatabaseMigrationResult> {
    if (options.targetVersion === 3) {
        const version = sqlite.pragma('user_version', { simple: true })

        if (version !== 0 && version !== 2 && version !== 3) {
            throw new Error('UNSUPPORTED_DATABASE_VERSION')
        }

        if (options.legacyMigrations.length !== 7) {
            throw new Error('UNSUPPORTED_LEGACY_MIGRATION_SET')
        }

        let base: Extract<DatabaseMigrationResult, { version: 2 }> | undefined

        if (version !== 3) {
            const result = await migrateDatabase(sqlite, {
                ...options,
                targetVersion: 2
            })

            if (result.version !== 2) {
                throw new Error('UNSUPPORTED_DATABASE_VERSION')
            }

            base = result
        }

        const result = await migrateDownloadStorage(sqlite, options)

        const marker = sqlite
            .prepare('SELECT backup_path FROM migration_run WHERE target_version = 2')
            .get() as { backup_path: string | null }

        const previousBackup = base?.backupPath ?? marker.backup_path

        if (previousBackup !== null && typeof previousBackup !== 'string') {
            throw new Error('V2_MARKER_MISMATCH')
        }

        return {
            ...result,
            version: 3,
            migrated: result.migrated || base?.migrated === true,
            legacyBackupPath: base?.legacyBackupPath ?? null,
            version2BackupPath: previousBackup
        }
    }

    if (options.targetVersion === 0) {
        const backupPath = await migrateLegacyDatabase(sqlite, options.legacyMigrations, {
            backupDirectory: options.backupDirectory,
            createBackup: options.legacyBackup
        })

        return {
            version: 0,
            backupPath
        }
    }

    if (options.targetVersion !== 2) {
        throw new Error('UNSUPPORTED_TARGET_VERSION')
    }

    const version = sqlite.pragma('user_version', { simple: true })

    if (version !== 0 && version !== 2) {
        throw new Error('UNSUPPORTED_DATABASE_VERSION')
    }

    if (options.legacyMigrations.length !== 7) {
        throw new Error('UNSUPPORTED_LEGACY_MIGRATION_SET')
    }

    const legacyBackupPath =
        version === 0
            ? await migrateLegacyDatabase(sqlite, options.legacyMigrations, {
                  backupDirectory: options.backupDirectory,
                  createBackup: options.legacyBackup
              })
            : null

    const result = await migrateToVersion2(sqlite, options)

    return {
        ...result,
        version: 2,
        legacyBackupPath
    }
}

export function legacyNumericTimeUnit(table: string, column: string): Unit {
    const key = table + '.' + column

    switch (key) {
        case 'profiles.updated_at':
        case 'download_urls.created_at':
        case 'media.created_at':
        case 'media.updated_at':
        case 'tag.updated_at':
        case 'favorite.created_at':
        case 'download_queue.created_at':
        case 'download_queue.updated_at':
            return 'seconds'

        default:
            throw new Error('UNCONFIRMED_LEGACY_TIMESTAMP_UNIT: ' + key)
    }
}

export interface Version3MigrationOptions extends Version2MigrationOptions {
    // 버전 2에 이미 있는 작업의 저장 루트를 호출부가 명시한다.
    // 버전 3 재실행에서는 기존 기록을 덮어쓰지 않는다.
    legacyStorageRoot?: string
}

export const downloadStorageSql = [
    `CREATE TABLE download_job_storage (
        job_id text PRIMARY KEY NOT NULL
            REFERENCES download_queue(id) ON DELETE CASCADE,
        storage_root text NOT NULL
            CHECK(typeof(storage_root) = 'text' AND length(storage_root) > 0),
        created_at integer NOT NULL
    )`,

    `CREATE TRIGGER download_storage_immutable
    BEFORE UPDATE ON download_job_storage
    BEGIN
        SELECT RAISE(ABORT, 'DOWNLOAD_STORAGE_IMMUTABLE');
    END`,

    `CREATE TRIGGER download_storage_required
    BEFORE DELETE ON download_job_storage
    WHEN EXISTS (SELECT 1 FROM download_queue WHERE id = OLD.job_id)
    BEGIN
        SELECT RAISE(ABORT, 'DOWNLOAD_STORAGE_REQUIRED');
    END`
] as const

function storageRoot(value: unknown): string {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) {
        throw new Error('DOWNLOAD_STORAGE_ROOT_REQUIRED')
    }

    return resolve(value)
}

function storageFingerprint(sqlite: Database.Database): string {
    const tables = rows(
        sqlite,
        `
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT GLOB 'sqlite_*'
          AND name NOT GLOB 'media_fts*'
        ORDER BY name
    `
    )

    return digest({
        schema: schemaSignature(sqlite),
        version: sqlite.pragma('user_version', { simple: true }),
        data: tables.map((table) => [
            table.name,
            rows(sqlite, 'SELECT * FROM ' + quote(String(table.name)) + ' ORDER BY rowid')
        ]),
        sequence: rows(sqlite, 'SELECT * FROM sqlite_sequence ORDER BY name')
    })
}

function validateLegacyStorage(sqlite: Database.Database, jobId: string, root: string): void {
    const attempts = sqlite
        .prepare('SELECT id, manifest_path FROM download_attempt WHERE job_id = ?')
        .all(jobId) as {
        id: string
        manifest_path: string | null
    }[]

    for (const attempt of attempts) {
        const owner = createHash('sha256')
            .update(JSON.stringify([jobId, attempt.id]))
            .digest('hex')

        const base = join(root, '.storagebucket')
        const staging = join(base, 'staging', owner)
        const final = join(base, 'files', owner)

        if (
            attempt.manifest_path !== null &&
            attempt.manifest_path !== join(base, 'manifests', owner + '.json')
        ) {
            throw new Error('DOWNLOAD_STORAGE_ROOT_CONFLICT')
        }

        const targets = sqlite
            .prepare('SELECT staged_path, final_path FROM download_target WHERE attempt_id = ?')
            .all(attempt.id) as {
            staged_path: string | null
            final_path: string | null
        }[]

        for (const target of targets) {
            for (const [path, directory] of [
                [target.staged_path, staging],
                [target.final_path, final]
            ] as const) {
                if (path !== null && dirname(path) !== directory) {
                    throw new Error('DOWNLOAD_STORAGE_ROOT_CONFLICT')
                }
            }
        }
    }
}

async function migrateDownloadStorage(
    sqlite: Database.Database,
    input: Version3MigrationOptions
): Promise<{
    migrated: boolean
    backupPath: string | null
    maintenancePending: boolean
}> {
    if (sqlite.inTransaction || sqlite.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new Error('MIGRATION_REQUIRES_IDLE_CONNECTION_WITH_FOREIGN_KEYS')
    }

    healthy(sqlite)

    const version = sqlite.pragma('user_version', { simple: true })

    if (version !== 2 && version !== 3) {
        throw new Error('UNSUPPORTED_DATABASE_VERSION')
    }

    const history = rows(
        sqlite,
        'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, hash'
    )

    const expectedHistory = input.legacyMigrations
        .map((migration) => ({
            hash: migration.hash,
            created_at: migration.folderMillis
        }))
        .sort((a, b) => a.created_at - b.created_at || a.hash.localeCompare(b.hash))

    if (encode(history) !== encode(expectedHistory)) {
        throw new Error('LEGACY_HISTORY_MISMATCH')
    }

    const baseHash = digest([input.schemaSql, schemaV2Guards])
    const schemaHash = digest([3, baseHash, downloadStorageSql])

    const baseMarker = sqlite
        .prepare('SELECT schema_hash, backup_path FROM migration_run WHERE target_version = 2')
        .get() as
        | {
              schema_hash: string
              backup_path: string | null
          }
        | undefined

    if (baseMarker?.schema_hash !== baseHash) {
        throw new Error('V2_MARKER_MISMATCH')
    }

    const expected = new Database(':memory:')

    try {
        for (const statement of input.schemaSql) {
            if (
                !/^\s*CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\b/i.test(statement) ||
                statement.replace(/;\s*$/, '').includes(';')
            ) {
                throw new Error('INVALID_SCHEMA_SQL')
            }

            expected.exec(statement)
        }

        expected.exec(historySql)

        for (const statement of schemaV2Guards) {
            expected.exec(statement)
        }

        if (hasFts(sqlite)) expected.exec(ftsSql)

        if (version === 3) {
            for (const statement of downloadStorageSql) {
                expected.exec(statement)
            }
        }

        if (schemaSignature(sqlite) !== schemaSignature(expected)) {
            throw new Error('DOWNLOAD_STORAGE_SCHEMA_MISMATCH')
        }
    } finally {
        expected.close()
    }

    const pending = () =>
        !!sqlite.prepare("SELECT 1 FROM maintenance_task WHERE state <> 'completed' LIMIT 1").get()

    if (version === 3) {
        const marker = sqlite
            .prepare('SELECT schema_hash, backup_path FROM migration_run WHERE target_version = 3')
            .get() as
            | {
                  schema_hash: string
                  backup_path: string | null
              }
            | undefined

        if (marker?.schema_hash !== schemaHash) {
            throw new Error('V3_MARKER_MISMATCH')
        }

        const bindings = sqlite
            .prepare(
                `
            SELECT q.id, s.storage_root
            FROM download_queue q
            LEFT JOIN download_job_storage s ON s.job_id = q.id
        `
            )
            .all() as {
            id: string
            storage_root: string | null
        }[]

        for (const binding of bindings) {
            if (binding.storage_root === null) {
                throw new Error('DOWNLOAD_STORAGE_BINDING_MISSING')
            }

            if (storageRoot(binding.storage_root) !== binding.storage_root) {
                throw new Error('DOWNLOAD_STORAGE_ROOT_INVALID')
            }

            validateLegacyStorage(sqlite, binding.id, binding.storage_root)
        }

        return {
            migrated: false,
            backupPath: marker!.backup_path,
            maintenancePending: pending()
        }
    }

    const jobs = sqlite.prepare('SELECT id FROM download_queue ORDER BY id').all() as {
        id: string
    }[]

    const root = jobs.length ? storageRoot(input.legacyStorageRoot) : null

    for (const job of jobs) {
        validateLegacyStorage(sqlite, job.id, root!)
    }

    const dataVersion = sqlite.pragma('data_version', { simple: true })
    const fingerprint = storageFingerprint(sqlite)

    const backup = input.backup
        ? await input.backup(sqlite)
        : await (async () => {
              const path = await createBackup(sqlite, input.backupDirectory)

              return {
                  path,
                  connection: new Database(path, {
                      readonly: true,
                      fileMustExist: true
                  })
              }
          })()

    if (backup.connection === sqlite) {
        throw new Error('INVALID_BACKUP_CONNECTION')
    }

    try {
        healthy(backup.connection)

        if (storageFingerprint(backup.connection) !== fingerprint) {
            throw new Error('BACKUP_MISMATCH')
        }
    } finally {
        backup.connection.close()
    }

    if (sqlite.inTransaction) {
        throw new Error('SOURCE_TRANSACTION_CHANGED')
    }

    sqlite
        .transaction(() => {
            if (
                sqlite.pragma('data_version', { simple: true }) !== dataVersion ||
                storageFingerprint(sqlite) !== fingerprint
            ) {
                throw new Error('SOURCE_CHANGED')
            }

            for (const statement of downloadStorageSql) {
                sqlite.exec(statement)
            }

            const now = Date.now()

            const bind = sqlite.prepare(
                'INSERT INTO download_job_storage(job_id, storage_root, created_at) VALUES (?, ?, ?)'
            )

            for (const job of jobs) {
                bind.run(job.id, root, now)
            }

            input.checkpoint?.('after_copy')

            insert(sqlite, 'migration_run', {
                id: randomUUID(),
                target_version: 3,
                source_fingerprint: fingerprint,
                schema_hash: schemaHash,
                backup_path: backup.path,
                completed_at: now
            })

            sqlite.pragma('user_version = 3')

            input.checkpoint?.('before_commit')

            healthy(sqlite)
        })
        .immediate()

    return {
        migrated: true,
        backupPath: backup.path,
        maintenancePending: pending()
    }
}

