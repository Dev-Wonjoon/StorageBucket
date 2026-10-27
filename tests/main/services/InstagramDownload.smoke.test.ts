import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Sql } from '../../../src/database/schema-v2.sql'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { downloadStorageSql } from '../../../src/database/migrate'
import type { V2Database } from '@features/media/MediaRepository'
import { createDownloadRuntime } from '@features/download/DownloadRuntime'
import { createMappedGalleryDlPolicy } from '@features/download/GalleryDlPolicy'
import { DownloadRepository, DownloadRepositoryError } from '@features/download/DownloadRepository'
import {
    EngineProcess,
    type EngineProcessRequest,
    type EngineProcessResult
} from '@features/download/EngineProcess'
import { projectRoot, requireTestWorkspace, testPath } from '../../helpers/test-workspace.cjs'

vi.mock('../../../src/database/index', () => {
    throw new Error('USER_DATABASE_IMPORTED')
})

vi.mock('@features/settings/ConfigManager', () => {
    throw new Error('USER_SETTINGS_IMPORTED')
})

vi.mock('@features/engines/BinManager', () => {
    throw new Error('USER_ENGINES_IMPORTED')
})

const workspace = requireTestWorkspace()
const url = process.env.STORAGEBUCKET_INSTAGRAM_TEST_URL?.trim()

if (
    process.env.STORAGEBUCKET_INSTAGRAM_SMOKE !== '1' ||
    !url ||
    !createMappedGalleryDlPolicy(url)?.accepts(url, {})
) {
    throw new Error('격리 실행기에 올바른 Instagram 게시물 URL을 지정해 주세요.')
}

const inputUrl: string = url
const executable = resolve(projectRoot, 'bin/gallery-dl.exe')
const hostScript = resolve(projectRoot, 'resources/engine-host.ps1')
const controller = new AbortController()
const pending = new Set<Promise<EngineProcessResult>>()
const engine = new EngineProcess(hostScript)

let sqlite: Database.Database | undefined
let db: V2Database
let halted = false
let jobId: string | undefined

const records: Record<string, unknown>[] = []
const report: Record<string, unknown> = {
    status: 'not-started',
    verified: false
}

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function safeName(value: unknown): string {
    return typeof value === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(value) ? value : 'other'
}

// 원본 응답과 직접 다운로드 URL을 저장하지 않고 진단 정보만 추린다.
function summarize(result: EngineProcessResult) {
    let rows: unknown[][] = []

    try {
        const value: unknown = JSON.parse(result.stdout)

        if (Array.isArray(value)) {
            rows = value.filter(Array.isArray)
        }
    } catch {
        return {
            json: 'invalid',
            stderrPresent: Boolean(result.stderr.trim())
        }
    }

    const errors = rows.filter((row) => row[0] === -1).map((row) => object(row[1]))

    const diagnostic = [
        result.stderr,
        ...errors.map((error) => (typeof error.message === 'string' ? error.message : ''))
    ].join('\n')

    return {
        json: 'parsed',
        messageTypes: rows.map((row) => (typeof row[0] === 'number' ? row[0] : null)),
        fileCount: rows.filter((row) => row[0] === 3).length,
        mediaTypes: [
            ...new Set(
                rows
                    .filter((row) => row[0] === 2 || row[0] === 3)
                    .map((row) => safeName(object(row.at(-1)).typename))
            )
        ],
        errors: errors.map((error) => safeName(error.error)),
        httpStatuses: [...new Set(diagnostic.match(/\b(?:401|403|404|429|500|502|503)\b/g) ?? [])],
        authenticationHint: /login|log.?in|cookie|challenge/i.test(diagnostic),
        stderrPresent: Boolean(result.stderr.trim())
    }
}

async function run(request: EngineProcessRequest): Promise<EngineProcessResult> {
    if (halted) {
        throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
    }

    if (request.executable !== executable) {
        throw new Error('예상하지 않은 엔진 실행을 차단했습니다.')
    }

    testPath(workspace, request.cwd)

    const phase = request.arguments.includes('--version')
        ? 'version'
        : request.arguments.includes('-J')
          ? 'discover'
          : request.arguments.includes('-f')
            ? 'download'
            : undefined

    if (!phase) {
        throw new Error('예상하지 않은 엔진 명령입니다.')
    }

    const record: Record<string, unknown> = {
        phase,
        status: 'running'
    }

    records.push(record)

    const operation = engine.run({
        ...request,
        signal: request.signal
            ? AbortSignal.any([request.signal, controller.signal])
            : controller.signal,
        timeoutMs: Math.min(request.timeoutMs ?? 60_000, 60_000),
        stopGraceMs: 5_000
    })

    pending.add(operation)

    try {
        const result = await operation
        record.status = 'finished'

        if (phase === 'discover') {
            record.summary = summarize(result)
        }

        return result
    } catch (error) {
        record.status = 'failed'
        record.code = error instanceof DownloadRepositoryError ? error.code : 'UNEXPECTED_ERROR'

        if (
            !(error instanceof DownloadRepositoryError) ||
            error.code === 'ENGINE_STOP_UNCONFIRMED'
        ) {
            halted = true
        }

        throw error
    } finally {
        pending.delete(operation)
    }
}

beforeAll(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...schemaV2Sql, ...schemaV2Guards, ...downloadStorageSql]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
})

afterAll(async () => {
    controller.abort()
    await Promise.allSettled([...pending])

    try {
        if (sqlite?.open) {
            if (jobId) {
                const job = new DownloadRepository(db).get(jobId)
                report.jobState = job?.state ?? null
                report.errorCode = job?.errorCode ?? null
            }

            report.foreignKeyErrors = sqlite.pragma('foreign_key_check')
        }

        report.engineStopUnconfirmed = halted
        report.engineCalls = records

        // 성공·실패 산출물을 보존하며 자동 정리하지 않는다.
        await writeFile(
            testPath(workspace, 'instagram-result.json'),
            JSON.stringify(report, null, 2),
            { flag: 'wx' }
        )
    } finally {
        sqlite?.close()
    }
}, 15_000)

it.skip('Instagram 단일 미디어를 실제로 저장하고 DB에 커밋한다', async () => {
    const workspace = requireTestWorkspace()
    const executable = resolve(projectRoot, 'bin/gallery-dl.exe')

    const runtime = createDownloadRuntime(db, {
        getStorageRoot: () => testPath(workspace, 'downloads'),
        engines: {
            getBinaries: () => ({
                ytDlp: resolve(projectRoot, 'bin/yt-dlp.exe'),
                ffmpeg: resolve(projectRoot, 'bin/ffmpeg.exe'),
                galleryDl: executable
            }),
            hostScript,
            nodeExecutable: process.execPath,
            workingDirectory: workspace,
            engine: { run }
        }
    })

    const queued = await runtime.service.enqueue({
        mode: 'create',
        url: inputUrl
    })

    if (!queued.ok) {
        throw new Error(queued.error.code)
    }

    jobId = queued.data.id

    const result = await runtime.service.run({
        jobId,
        trigger: 'manual_initial'
    })

    if (!result.ok) {
        report.status = 'failed'
        throw new Error(result.error.code)
    }

    report.status = result.data.status

    if (result.data.status !== 'committed') {
        const job = new DownloadRepository(db).get(jobId)

        throw new Error(result.data.status + ': ' + (job?.errorCode ?? 'UNKNOWN'))
    }

    const files = sqlite!
        .prepare(
            'SELECT filepath, kind, filesize, content_hash AS contentHash ' +
                'FROM media_file WHERE media_id = ?'
        )
        .all(result.data.mediaIdSnapshot) as {
        filepath: string
        kind: string
        filesize: number
        contentHash: string
    }[]

    expect(files).toHaveLength(1)

    const file = files[0]
    const filepath = testPath(workspace, file.filepath)
    const info = await lstat(filepath)

    expect(info.isFile()).toBe(true)
    expect(info.size).toBeGreaterThan(0)
    expect(info.size).toBe(file.filesize)

    const hash = createHash('sha256')

    for await (const chunk of createReadStream(filepath)) {
        hash.update(chunk)
    }

    expect(hash.digest('hex')).toBe(file.contentHash)

    // 원본 게시물 재추출 없이 고정한 대상으로 한 번만 다운로드한다.
    expect(records.filter((record) => record.phase === 'discover')).toHaveLength(1)
    expect(records.filter((record) => record.phase === 'download')).toHaveLength(1)

    expect(sqlite!.pragma('foreign_key_check')).toEqual([])

    report.verified = true
    report.file = {
        filepath,
        kind: file.kind,
        size: info.size,
        sha256: file.contentHash
    }
}, 240_000)
