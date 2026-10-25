import type Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaRepository } from '../../src/main/repositories/MediaRepository'
import { MediaService } from '../../src/main/services/MediaService'

const state = vi.hoisted(() => ({
    root: '',
    beforeQuit: undefined as (() => void) | undefined,
    connections: [] as Database.Database[],
    calls: 0,
    failMigration: false,
    failSearch: false
}))

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => state.root,
        on: (event: string, listener: () => void) => {
            if (event === 'before-quit') {
                state.beforeQuit = listener
            }
        }
    }
}))

vi.mock('../../src/main/utils/portablePath', () => ({
    getDatabasePath: () => ':memory:'
}))

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>()

    return {
        ...actual,
        mkdirSync: vi.fn()
    }
})

vi.mock('../../src/database/migrate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/database/migrate')>()

    const { default: NativeDatabase } = await import('better-sqlite3')

    return {
        ...actual,
        migrateDatabase: async (...args: Parameters<typeof actual.migrateDatabase>) => {
            const [connection, options] = args

            state.connections.push(connection)
            state.calls++

            if (state.failMigration) {
                throw new Error('INJECTED_MIGRATION_FAILURE')
            }

            if (options.targetVersion !== 3) {
                throw new Error('EXPECTED_VERSION_3')
            }

            return actual.migrateDatabase(connection, {
                ...options,
                legacyBackup: async () => 'memory-legacy-backup',
                backup: async (source) => ({
                    path: 'memory-backup',
                    connection: new NativeDatabase(source.serialize())
                }),
                ...(state.failSearch
                    ? {
                          rebuildSearch: () => {
                              throw new Error('INJECTED_FTS_FAILURE')
                          }
                      }
                    : {})
            })
        }
    }
})

beforeEach(() => {
    vi.resetModules()

    state.root = fileURLToPath(new URL('../../', import.meta.url))
    state.beforeQuit = undefined
    state.connections = []
    state.calls = 0
    state.failMigration = false
    state.failSearch = false

    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    state.beforeQuit?.()

    for (const connection of state.connections) {
        if (connection.open) connection.close()
    }

    vi.restoreAllMocks()
})

describe('앱 DB 초기화', () => {
    it('import만으로 DB를 열지 않고 준비 전 조회를 차단한다', async () => {
        const module = await import('../../src/database/index')

        expect(state.calls).toBe(0)
        expect(() => module.getDB()).toThrow('DATABASE_NOT_READY')
    })

    it('동시 초기화를 공유하고 새 구조로 연결한 뒤 같은 DB를 반환한다', async () => {
        const module = await import('../../src/database/index')
        const first = module.initDB()

        expect(module.initDB()).toBe(first)
        await first

        const client = module.getDB()
        await module.initDB()

        expect(module.getDB()).toBe(client)
        expect(state.calls).toBe(1)

        const connection = state.connections[0]

        expect(connection.pragma('user_version', { simple: true })).toBe(3)

        expect(connection.pragma('foreign_keys', { simple: true })).toBe(1)

        expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')

        expect(connection.pragma('foreign_key_check')).toEqual([])
    })

    it('미디어 서비스가 초기화된 동일 DB의 부모·자식을 조회한다', async () => {
        const module = await import('../../src/database/index')
        await module.initDB()

        state.connections[0].exec(`
            INSERT INTO media(id, source_kind, source_title, created_at)
            VALUES (42, 'legacy', '시작 DB', 1800000000000);

            INSERT INTO media_file(
                media_id,
                file_key,
                storage_kind,
                filepath,
                kind,
                position,
                created_at
            )
            VALUES (
                42,
                'fixture',
                'unverified_legacy',
                'C:/fixture/a.png',
                'unknown',
                0,
                1800000000000
            );
        `)

        const service = new MediaService(new MediaRepository(module.getDB()))

        const result = service.get({ mediaId: 42 })

        expect(result.ok).toBe(true)
        if (!result.ok) throw new Error('Expected media detail')

        expect(result.data.title).toBe('시작 DB')
        expect(result.data.files.data).toHaveLength(1)
        expect(result.data.files.data[0].storageKind).toBe('unverified_legacy')
    })

    it('이관 실패 시 연결을 닫고 DB를 공개하지 않으며 재시도할 수 있다', async () => {
        const module = await import('../../src/database/index')
        state.failMigration = true

        await expect(module.initDB()).rejects.toThrow('INJECTED_MIGRATION_FAILURE')

        expect(state.connections[0].open).toBe(false)
        expect(() => module.getDB()).toThrow('DATABASE_NOT_READY')

        state.failMigration = false
        await module.initDB()

        expect(state.calls).toBe(2)
        expect(() => module.getDB()).not.toThrow()
    })

    it('FTS 실패가 이관 완료와 미디어 DB 공개를 취소하지 않는다', async () => {
        const module = await import('../../src/database/index')
        state.failSearch = true

        await module.initDB()

        expect(() => module.getDB()).not.toThrow()

        expect(state.connections[0].pragma('user_version', { simple: true })).toBe(3)

        expect(
            state.connections[0]
                .prepare(
                    `
                SELECT count(*) FROM maintenance_task
                WHERE kind = 'search_reindex' AND state = 'pending'
            `
                )
                .pluck()
                .get()
        ).toBe(1)

        expect(console.warn).toHaveBeenCalled()
    })

    it('종료 시 연결을 닫고 새 초기화를 차단한다', async () => {
        const module = await import('../../src/database/index')
        await module.initDB()

        state.beforeQuit?.()

        expect(state.connections[0].open).toBe(false)
        expect(() => module.getDB()).toThrow('DATABASE_NOT_READY')

        await expect(module.initDB()).rejects.toThrow('DATABASE_SHUTTING_DOWN')
    })

    it('초기화 도중 종료되면 DB를 공개하지 않는다', async () => {
        const module = await import('../../src/database/index')
        const pending = module.initDB()

        state.beforeQuit?.()

        await expect(pending).rejects.toThrow('DATABASE_SHUTTING_DOWN')

        expect(state.connections[0].open).toBe(false)
        expect(() => module.getDB()).toThrow('DATABASE_NOT_READY')
    })
})
