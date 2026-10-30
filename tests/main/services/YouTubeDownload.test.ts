import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Sql } from '../../../src/database/schema-v2.sql'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { downloadStorageSql } from '../../../src/database/migrate'
import { DownloadRepository } from '@features/download/DownloadRepository'
import {
    EngineProcess,
    type EngineProcessRequest
} from '../../../src/main/features/download/EngineProcess'
import { YTDLP_VERSION } from '../../../src/main/features/download/YtdlpAdapter'
import {
    createYouTubePolicy,
    createYouTubeDownloadRuntime
} from '../../../src/main/features/download/YouTubeDownload'
import {
    createTestWorkspace,
    cleanupTestWorkspace,
    requireTestWorkspace,
    testPath
} from '../../helpers/test-workspace.cjs'

requireTestWorkspace()

// 기본 테스트에서는 네트워크에 접속하지 않는 합성 데이터다.
const id = 'BaW_jenozKc'
const url = 'https://www.youtube.com/watch?v=' + id

function document() {
    return {
        id,
        title: 'synthetic video',
        extractor: 'youtube',
        extractor_key: 'Youtube',
        webpage_url: url,
        availability: 'public',
        age_limit: 0,
        live_status: 'not_live',
        duration: 10,
        vcodec: 'h264',
        acodec: 'aac',
        formats: [
            {
                format_id: 'sb0',
                protocol: 'mhtml',
                ext: 'mhtml',
                vcodec: 'none',
                acodec: 'none',
                url: 'https://example.invalid/storyboard'
            },
            {
                format_id: '18',
                protocol: 'https',
                ext: 'mp4',
                vcodec: 'h264',
                acodec: 'aac',
                url: 'https://example.invalid/video.mp4'
            }
        ]
    }
}

describe('YouTube 단일 영상 정책', () => {
    it.each([
        url,
        'https://youtu.be/' + id + '?si=tracking',
        'https://www.youtube.com/shorts/' + id
    ])('단일 영상 URL을 허용한다: %s', (value) => {
        const policy = createYouTubePolicy(value)!

        expect(policy.accepts(value, {})).toBe(true)

        const info = document()

        expect(policy.identify(info, [info])).toEqual(['youtube:' + id])
    })

    it.each([
        'https://www.youtube.com/playlist?list=PL123',
        url + '&list=PL123',
        url + '&v=abcdefghijk',
        url + '&start=1',
        url + '#t=1',
        'https://www.youtube.com/@channel',
        'https://www.youtube.com/live/' + id,
        'https://youtube.com.evil.invalid/watch?v=' + id,
        'http://www.youtube.com/watch?v=' + id,
        'https://name:password@www.youtube.com/watch?v=' + id
    ])('지원 범위 밖 URL을 거부한다: %s', (value) => {
        expect(createYouTubePolicy(value)).toBeUndefined()
    })

    it('재생목록 옵션과 다른 영상 ID를 거부한다', () => {
        const policy = createYouTubePolicy(url)!

        expect(policy.accepts(url, { playlist: true })).toBe(false)

        expect(policy.accepts('https://www.youtube.com/watch?v=abcdefghijk', {})).toBe(false)

        const info = { ...document(), id: 'abcdefghijk' }

        expect(policy.identify(info, [info])).toBeUndefined()
    })

    it.each([
        { availability: 'private' },
        { availability: 'unlisted' },
        { availability: null },
        { age_limit: 18 },
        { live_status: 'is_live' },
        { live_status: 'was_live' },
        { has_drm: true },
        { extractor_key: 'Generic' },
        { entries: [] }
    ])('공개 일반 영상 조건을 확인한다: %j', (changes) => {
        const info = { ...document(), ...changes }

        expect(createYouTubePolicy(url)!.identify(info, [info])).toBeUndefined()
    })
})

describe('YouTube 다운로드 연결', () => {
    let root: string | undefined
    let sqlite: Database.Database | undefined
    let calls: EngineProcessRequest[]
    let nodeVersion: string

    const binaries = () => ({
        ytDlp: resolve('bin/yt-dlp.exe'),
        ffmpeg: resolve('bin/ffmpeg.exe')
    })

    const nodeExecutable = resolve('node_modules/electron/dist/electron.exe')

    const hostScript = resolve('resources/engine-host.ps1')

    beforeEach(async () => {
        root = undefined
        sqlite = undefined

        root = createTestWorkspace('youtube-download')

        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')

        for (const statement of [...schemaV2Sql, ...schemaV2Guards, ...downloadStorageSql]) {
            sqlite.exec(statement)
        }

        calls = []
        nodeVersion = 'v24.22.0'
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
                cleanupTestWorkspace(owned)
            }
        }
    })

    async function fake(request: EngineProcessRequest) {
        calls.push(request)

        if (request.executable === nodeExecutable) {
            return { stdout: nodeVersion, stderr: '' }
        }

        if (request.executable === binaries().ffmpeg) {
            return {
                stdout: 'ffmpeg version synthetic',
                stderr: ''
            }
        }

        if (request.arguments.includes('--version')) {
            return { stdout: YTDLP_VERSION, stderr: '' }
        }

        if (request.arguments.includes('--dump-single-json')) {
            return {
                stdout: JSON.stringify(document()),
                stderr: ''
            }
        }

        const info = JSON.parse(request.input!)

        expect(info.formats).toHaveLength(1)
        expect(info.formats[0].protocol).toBe('https')
        expect(request.arguments).toContain('--no-js-runtimes')
        expect(request.arguments).toContain('node:' + nodeExecutable)

        const output = request.arguments[request.arguments.indexOf('--output') + 1]

        const file = testPath(root!, request.cwd, output.replace('%(ext)s', 'mp4'))

        await writeFile(file, 'synthetic-video', { flag: 'wx' })

        return {
            stdout: JSON.stringify(file) + '\n',
            stderr: ''
        }
    }

    function runtime(real = false, selectedRoot?: string) {
        return createYouTubeDownloadRuntime(drizzle(sqlite!, { schema: s }), {
            getStorageRoot: () => selectedRoot ?? root!,
            getBinaries: binaries,
            hostScript,
            nodeExecutable,
            workingDirectory: root!,
            ...(real ? {} : { engine: { run: fake } })
        })
    }

    it('기존 진입점도 미등록 URL을 엔진 실행 없이 등록한다', async () => {
        const result = await runtime().service.enqueue({
            mode: 'create',
            url: 'https://example.invalid/post'
        })

        expect(result.ok).toBe(true)

        expect(sqlite!.prepare('SELECT count(*) FROM download_urls').pluck().get()).toBe(1)

        expect(sqlite!.prepare('SELECT count(*) FROM download_queue').pluck().get()).toBe(1)

        expect(calls).toEqual([])
    })

    it('조회한 대상을 고정하고 파일 저장과 DB 커밋을 완료한다', async () => {
        const service = runtime().service
        const enqueued = await service.enqueue({
            mode: 'create',
            url
        })

        if (!enqueued.ok) throw new Error('Expected queue')

        const result = await service.run({
            jobId: enqueued.data.id,
            trigger: 'manual_initial'
        })

        expect(result.ok && result.data.status).toBe('committed')

        expect(sqlite!.prepare('SELECT count(*) FROM media_file').pluck().get()).toBe(1)

        const discoveries = calls.filter((call) => call.arguments.includes('--dump-single-json'))

        expect(discoveries).toHaveLength(1)
        expect(discoveries[0].arguments).toContain('node:' + nodeExecutable)
        expect(discoveries[0].arguments).toContain('--no-cookies')
    })

    it('다운로드 폴더가 없으면 준비한 뒤 저장한다', async () => {
        const selected = join(root!, 'downloads')
        const service = runtime(false, selected).service

        const first = await service.enqueue({
            mode: 'create',
            url
        })

        if (!first.ok) throw new Error('Expected queue')

        const result = await service.run({
            jobId: first.data.id,
            trigger: 'manual_initial'
        })

        const job = new DownloadRepository(drizzle(sqlite!, { schema: s })).get(first.data.id)

        expect(
            result.ok && result.data.status,
            JSON.stringify({
                result,
                errorCode: job?.errorCode
            })
        ).toBe('committed')

        const file = sqlite!.prepare('SELECT filepath FROM media_file').pluck().get() as string

        expect(file.startsWith(join(selected, '.storagebucket', 'files'))).toBe(true)
    })

    it('Node 버전 확인 실패는 attempt와 정리 작업을 만들지 않는다', async () => {
        nodeVersion = 'v20.0.0'

        const service = runtime().service
        const enqueued = await service.enqueue({
            mode: 'create',
            url
        })

        if (!enqueued.ok) throw new Error('Expected queue')

        const result = await service.run({
            jobId: enqueued.data.id,
            trigger: 'manual_initial'
        })

        expect(result.ok ? null : result.error.code).toBe('DOWNLOAD_ENGINE_FAILED')

        expect(sqlite!.prepare('SELECT count(*) FROM download_attempt').pluck().get()).toBe(0)

        expect(sqlite!.prepare('SELECT count(*) FROM maintenance_task').pluck().get()).toBe(0)
    })

    it('이전 실행의 종료가 불명확하면 새 작업을 보류한다', async () => {
        const first = await runtime().service.enqueue({
            mode: 'create',
            url
        })

        if (!first.ok) throw new Error('Expected queue')

        new DownloadRepository(drizzle(sqlite!, { schema: s })).startAttempt(
            first.data.id,
            'manual_initial'
        )

        const result = await runtime().service.enqueue({
            mode: 'create',
            url
        })

        expect(result.ok ? null : result.error.code).toBe('ENGINE_STOP_UNCONFIRMED')

        expect(sqlite!.prepare('SELECT count(*) FROM download_queue').pluck().get()).toBe(1)

        expect(calls).toEqual([])
    })

    it.skipIf(process.platform !== 'win32' || process.env.STORAGEBUCKET_ENGINE_HOST_SMOKE !== '1')(
        'Electron의 Node 모드를 종료 확인 호스트에서 실행한다',
        async () => {
            const before = process.env.ELECTRON_RUN_AS_NODE

            const engine = new EngineProcess(hostScript, {
                electronAsNode: true
            })

            const result = await engine.run({
                executable: nodeExecutable,
                arguments: ['--permission', '-'],
                cwd: root!,
                input: `
                    console.log(JSON.stringify({
                        version: process.versions.node,
                        mode: process.env.ELECTRON_RUN_AS_NODE
                    }))
                `,
                timeoutMs: 30_000
            })

            const value = JSON.parse(result.stdout)

            expect(Number(value.version.split('.')[0])).toBeGreaterThanOrEqual(22)

            expect(value.mode).toBe('1')
            expect(process.env.ELECTRON_RUN_AS_NODE).toBe(before)
        }
    )

    it.skipIf(process.env.STORAGEBUCKET_LIVE_YOUTUBE !== '1')(
        '공식 공개 5초 샘플의 실제 다운로드',
        async () => {
            const service = runtime(true).service

            const first = await service.enqueue({
                mode: 'create',
                url: 'https://www.youtube.com/watch?v=f6HNySwZV4c'
            })

            if (!first.ok) throw new Error(first.error.code)

            const result = await service.run({
                jobId: first.data.id,
                trigger: 'manual_initial'
            })

            expect(result.ok ? result.data.status : result.error.code).toBe('committed')
        },
        180_000
    )
})
