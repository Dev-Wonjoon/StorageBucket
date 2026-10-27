import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Sql } from '../../../src/database/schema-v2.sql'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import type { V2Database } from '@features/media/MediaRepository'
import { DownloadRepository } from '@features/download/DownloadRepository'
import { createDownloadRuntime, type DownloadRuntime } from '@features/download/DownloadRuntime'
import type { FrozenDownloadAdapter } from '@features/download/DownloadAdapter'
import type { DownloadResponse } from '../../../src/shared/download-api'
import { downloadStorageSql } from '../../../src/database/migrate'
import { DownloadRootRepository } from '@features/download/DownloadRootRepository'
import {
    createTestWorkspace,
    cleanupTestWorkspace,
    requireTestWorkspace,
    testPath
} from '../../helpers/test-workspace.cjs'

requireTestWorkspace()

vi.mock('../../../src/database/index', () => {
    throw new Error('USER_DATABASE_IMPORTED')
})

vi.mock('@features/settings/ConfigManager', () => {
    throw new Error('USER_SETTINGS_IMPORTED')
})

vi.mock('@features/engines/BinManager', () => {
    throw new Error('USER_ENGINES_IMPORTED')
})

let sqlite: Database.Database | undefined
let db: V2Database
let jobs: DownloadRepository
let runtime: DownloadRuntime
let root: string | undefined
let adapter: FrozenDownloadAdapter
let calls: string[]
let failDiscovery: boolean
let partialPath: string | undefined
let currentStorageRoot: string

function data<T>(response: DownloadResponse<T>): T {
    assert.ok(response.ok)
    return response.data
}

beforeEach(async () => {
    root = undefined
    sqlite = undefined

    root = createTestWorkspace('download-runtime')
    currentStorageRoot = root

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...schemaV2Sql, ...schemaV2Guards, ...downloadStorageSql]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    jobs = new DownloadRepository(db)

    calls = []
    failDiscovery = false
    partialPath = undefined

    adapter = {
        async discover() {
            calls.push('discover')

            if (failDiscovery) {
                throw new Error('synthetic discovery failure')
            }

            return ['a', 'b'].map((targetKey) => ({
                targetKey,
                sourceUrl: 'https://example.invalid/' + targetKey,
                metadata: {
                    kind: 'unknown',
                    title: targetKey
                }
            }))
        },

        async downloadFrozen(input) {
            calls.push('download')

            const results: {
                targetKey: string
                stagedPath: string
            }[] = []

            for (const target of input.targets) {
                const stagedPath = testPath(
                    root!,
                    input.stagingDirectory,
                    target.targetKey + '.bin'
                )

                await writeFile(stagedPath, 'fixture-' + target.targetKey, { flag: 'wx' })

                results.push({
                    targetKey: target.targetKey,
                    stagedPath
                })
            }

            return results
        }
    }

    runtime = createDownloadRuntime(db, {
        getStorageRoot: () => currentStorageRoot,
        selectAdapter: () => adapter
    })
})

afterEach(async () => {
    try {
        if (sqlite?.open) {
            expect(sqlite.pragma('foreign_key_check')).toEqual([])
        }
    } finally {
        if (sqlite?.open) sqlite.close()

        const owned = root
        root = undefined

        if (owned) {
            if (owned) {
                cleanupTestWorkspace(owned)
            }
        }
    }
})

async function enqueue(url = 'https://example.invalid/post') {
    return data(
        await runtime.service.enqueue({
            mode: 'create',
            url
        })
    )
}

describe('DownloadRuntime integration', () => {
    it('설정이 B로 바뀌어도 기존 작업은 A에서 실행하고 새 작업은 B에서 실행한다', async () => {
        const rootA = root!
        const rootB = testPath(rootA, 'B')

        await mkdir(rootB)

        const selected: string[] = []

        runtime = createDownloadRuntime(db, {
            getStorageRoot: () => currentStorageRoot,

            selectAdapter: (storageRoot) => {
                selected.push(storageRoot)
                return adapter
            }
        })

        const old = await enqueue('https://example.invalid/old')

        currentStorageRoot = rootB

        const added = await enqueue('https://example.invalid/new')

        const first = data(
            await runtime.service.run({
                jobId: old.id,
                trigger: 'manual_initial'
            })
        )

        const second = data(
            await runtime.service.run({
                jobId: added.id,
                trigger: 'manual_initial'
            })
        )

        if (first.status !== 'committed' || second.status !== 'committed') {
            throw new Error('Expected two commits')
        }

        const roots = new DownloadRootRepository(db)

        expect(roots.get(old.id)).toBe(rootA)
        expect(roots.get(added.id)).toBe(rootB)
        expect(selected).toEqual([rootA, rootB])

        const files = db.select().from(s.mediaFiles).all()

        const oldFiles = files.filter((file) => file.mediaId === first.mediaIdSnapshot)

        const newFiles = files.filter((file) => file.mediaId === second.mediaIdSnapshot)

        expect(oldFiles).toHaveLength(2)
        expect(newFiles).toHaveLength(2)

        expect(
            oldFiles.every((file) =>
                file.filepath.startsWith(join(rootA, '.storagebucket', 'files'))
            )
        ).toBe(true)

        expect(
            newFiles.every((file) =>
                file.filepath.startsWith(join(rootB, '.storagebucket', 'files'))
            )
        ).toBe(true)

        expect(runtime.recovery.inspect(old.id).status).toBe('committed')
    })

    it('B로 설정을 바꾼 뒤에도 A 작업의 실패 정리는 A에서 수행한다', async () => {
        const rootA = root!
        const rootB = testPath(rootA, 'B')

        await mkdir(rootB)

        const job = await enqueue()

        currentStorageRoot = rootB
        failDiscovery = true

        const result = data(
            await runtime.service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        if (result.status !== 'cleanup_required') {
            throw new Error('Expected cleanup')
        }

        // 합성 엔진의 Promise가 끝났고 다른 실행·미디어 편집도 없다.
        await runtime.cleanup.runAtStartup(result.taskId)

        expect(new DownloadRootRepository(db).get(job.id)).toBe(rootA)

        expect(jobs.get(job.id)!.cleanupRequired).toBe(false)
        expect(await readdir(rootB)).toEqual([])
    })

    it('조립·큐 조회만으로 파일을 만들거나 작업을 자동 실행하지 않는다', async () => {
        const job = await enqueue()
        const filesBefore = (await readdir(root!)).sort()

        const restored = createDownloadRuntime(db, {
            getStorageRoot: () => currentStorageRoot,
            selectAdapter: () => adapter
        })

        const page = data(await restored.service.list())

        expect(page.data.map((row) => row.id)).toEqual([job.id])
        expect(jobs.get(job.id)!.state).toBe('pending')
        expect(db.select().from(s.downloadAttempts).all()).toEqual([])
        expect((await readdir(root!)).sort()).toEqual(filesBefore)
        expect(calls).toEqual([])
    })

    it('명시적 실행에서 실제 파일 검증·저장과 부모·자식 커밋을 연결한다', async () => {
        const job = await enqueue()

        const result = data(
            await runtime.service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('committed')

        if (result.status !== 'committed') {
            throw new Error('Expected commit')
        }

        const parent = db.select().from(s.medias).get()!
        const files = db.select().from(s.mediaFiles).all()

        expect(parent.id).toBe(result.mediaIdSnapshot)
        expect(parent.sourceKind).toBe('download')
        expect(parent.lastDownloadCommitAttemptId).toBe(result.attemptId)
        expect(files).toHaveLength(2)
        expect(calls).toEqual(['discover', 'download'])

        for (const file of files) {
            expect(file.mediaId).toBe(parent.id)
            expect(file.storageKind).toBe('app_managed')

            expect(file.filepath.startsWith(join(root!, '.storagebucket', 'files'))).toBe(true)

            const bytes = await readFile(file.filepath)

            expect(bytes.toString()).toBe('fixture-' + file.fileKey)

            expect(file.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'))
        }

        expect(jobs.get(job.id)!.state).toBe('completed')
        expect(jobs.get(job.id)!.cleanupRequired).toBe(false)
        expect(runtime.recovery.inspect(job.id).status).toBe('committed')
    })

    it('실패 후 정리를 거친 수동 재시도를 같은 구성으로 실행한다', async () => {
        const job = await enqueue()
        failDiscovery = true

        const failed = data(
            await runtime.service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(failed.status).toBe('cleanup_required')

        if (failed.status !== 'cleanup_required') {
            throw new Error('Expected cleanup')
        }

        expect(jobs.get(job.id)!.state).toBe('failed')
        expect(jobs.get(job.id)!.cleanupRequired).toBe(true)

        // 합성 어댑터는 자식 프로세스를 만들지 않았고 Promise도 종료됐다.
        // 다른 다운로드·미디어 편집도 없는 상태다.
        await runtime.cleanup.runAtStartup(failed.taskId)

        expect(jobs.get(job.id)!.cleanupRequired).toBe(false)

        failDiscovery = false

        const retried = data(
            await runtime.service.run({
                jobId: job.id,
                trigger: 'manual_retry'
            })
        )

        expect(retried.status).toBe('committed')
        expect(db.select().from(s.downloadAttempts).all()).toHaveLength(2)
        expect(db.select().from(s.mediaFiles).all()).toHaveLength(2)
    })

    it('증명되지 않은 부분 출력은 정리 과정에서 삭제하지 않는다', async () => {
        const job = await enqueue()

        adapter.downloadFrozen = async (input) => {
            partialPath = testPath(root!, input.stagingDirectory, 'partial.bin')

            await writeFile(partialPath, 'keep-partial', { flag: 'wx' })

            throw new Error('synthetic partial failure')
        }

        const result = data(
            await runtime.service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('cleanup_required')

        if (result.status !== 'cleanup_required') {
            throw new Error('Expected cleanup')
        }

        await expect(runtime.cleanup.runAtStartup(result.taskId)).rejects.toMatchObject({
            code: 'CLEANUP_REQUIRED'
        })

        expect(await readFile(partialPath!, 'utf8')).toBe('keep-partial')
        expect(jobs.get(job.id)!.cleanupRequired).toBe(true)
        expect(db.select().from(s.medias).all()).toEqual([])
        expect(db.select().from(s.mediaFiles).all()).toEqual([])
    })

    it('정지된 실행의 시작 복구는 새 attempt나 다운로드를 만들지 않는다', async () => {
        const job = await enqueue()

        jobs.startAttempt(job.id, 'manual_initial')

        const restored = createDownloadRuntime(db, {
            getStorageRoot: () => currentStorageRoot,
            selectAdapter: () => adapter
        })

        expect(jobs.get(job.id)!.state).toBe('running')

        // 이 합성 실행에서는 엔진을 시작하지 않았다.
        const recovered = restored.recovery.recoverAtStartup(job.id)

        expect(recovered.status).toBe('cleanup_required')

        if (recovered.status !== 'cleanup_required') {
            throw new Error('Expected cleanup')
        }

        expect(jobs.get(job.id)!.state).toBe('interrupted')
        expect(db.select().from(s.downloadAttempts).all()).toHaveLength(1)
        expect(calls).toEqual([])

        await restored.cleanup.runAtStartup(recovered.taskId)

        expect(jobs.get(job.id)!.cleanupRequired).toBe(false)
        expect(jobs.get(job.id)!.state).toBe('interrupted')
        expect(db.select().from(s.downloadAttempts).all()).toHaveLength(1)
        expect(calls).toEqual([])
    })
})
