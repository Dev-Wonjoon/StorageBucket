import { app } from 'electron'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import * as schema from './schema-v2'
import { schemaV2Sql } from './schema-v2.sql'
import { legacyNumericTimeUnit, migrateDatabase } from './migrate'
import { getDatabasePath } from '../main/infrastructure/portablePath'

let sqlite: Database.Database | undefined
let db: BetterSQLite3Database<typeof schema> | undefined
let initializing: Promise<void> | undefined
let shuttingDown = false

export function getDB(): BetterSQLite3Database<typeof schema> {
    if (!sqlite?.open || !db) {
        throw new Error('DATABASE_NOT_READY')
    }

    return db
}

export function initDB({ legacyStorageRoot }: { legacyStorageRoot?: string } = {}): Promise<void> {
    if (shuttingDown) {
        return Promise.reject(new Error('DATABASE_SHUTTING_DOWN'))
    }

    if (sqlite?.open && db) return Promise.resolve()
    if (initializing) return initializing

    initializing = (async () => {
        const databasePath = getDatabasePath()

        mkdirSync(dirname(databasePath), { recursive: true })

        const connection = new Database(databasePath)

        try {
            connection.pragma('foreign_keys = ON')
            connection.pragma('busy_timeout = 5000')

            const migrationsFolder = app.isPackaged
                ? join(process.resourcesPath, 'drizzle')
                : join(app.getAppPath(), 'drizzle')

            const result = await migrateDatabase(connection, {
                targetVersion: 3,
                legacyStorageRoot,
                legacyMigrations: readMigrationFiles({ migrationsFolder }),
                schemaSql: [...schemaV2Sql],
                numericTimeUnit: legacyNumericTimeUnit,
                backupDirectory: join(dirname(databasePath), 'backups')
            })

            if (shuttingDown) {
                throw new Error('DATABASE_SHUTTING_DOWN')
            }

            const client = drizzle(connection, { schema })

            sqlite = connection
            db = client

            if (result.version === 3) {
                if (result.legacyBackupPath) {
                    console.log('[Database] Legacy backup ready:', result.legacyBackupPath)
                }

                if (result.version2BackupPath) {
                    console.log('[Database] Version 2 backup available:', result.version2BackupPath)
                }

                if (result.backupPath) {
                    console.log('[Database] Migration backup ready:', result.backupPath)
                }

                if (result.maintenancePending) {
                    console.warn('[Database] Pending maintenance tasks remain.')
                }
            }
        } catch (error) {
            if (connection.open) connection.close()
            throw error
        }
    })().finally(() => {
        initializing = undefined
    })

    return initializing
}

app.on('before-quit', () => {
    shuttingDown = true

    const connection = sqlite

    sqlite = undefined
    db = undefined

    if (connection?.open) connection.close()
})
