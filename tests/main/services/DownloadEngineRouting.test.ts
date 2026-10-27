import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { sep } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Sql } from '../../../src/database/schema-v2.sql'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { downloadStorageSql } from '../../../src/database/migrate'
import type { V2Database } from '@features/media/MediaRepository'
import type { DownloadResponse } from '../../../src/shared/download-api'
import {
    createDownloadRuntime,
    type DownloadEngineOptions
} from '@features/download/DownloadRuntime'
import { DownloadRepository, DownloadRepositoryError } from '@features/download/DownloadRepository'
import type { EngineProcessRequest } from '@features/download/EngineProcess'
import { YTDLP_VERSION } from '@features/download/YtdlpAdapter'
import { GALLERYDL_VERSION } from '@features/download/GalleryDlAdapter'
import {
    createTestWorkspace,
    cleanupTestWorkspace,
    requireTestWorkspace,
    testPath
} from '../../helpers/test-workspace.cjs'

vi.mock('../../../src/database/index', () => {
    throw new Error('USER_DATABASE_IMPORTED')
})

vi.mock('@features/settings/ConfigManager', () => {
    throw new Error('USER_SETTINGS_IMPORTED')
})

vi.mock('@features/engines/BinManager', () => {
    throw new Error('USER_ENGINES_IMPORTED')
})

requireTestWorkspace()

const instagram = 'https://www.instagram.com/p/Synthetic01/'

const youtubeId = 'BaW_jenozKc'
const youtube = 'https://www.youtube.com/watch?v=' + youtubeId

const mediaId = '9007199254740993123'

// 파일 저장·해시·DB 연결을 검증하는 합성 바이트다.
const bytes = Buffer.from('synthetic-media')

let root: string
let selectedRoot: string
let sqlite: Database.Database | undefined
let db: V2Database
let calls: EngineProcessRequest[]
let galleryType: string
let diagnostics: string
let wrongSource: boolean
let galleryVersion: string
let stagedPath: string | undefined

let downloadFailure: 'DOWNLOAD_ENGINE_FAILED' | 'ENGINE_STOP_UNCONFIRMED' | undefined

let binaries: {
    ytDlp: string
    ffmpeg: string
    galleryDl: string
}

let nodeExecutable: string

function data<T>(response: DownloadResponse<T>): T {
    if (!response.ok) {
        throw new Error(response.error.code)
    }

    return response.data
}

function youtubeDocument() {
    return {
        id: youtubeId,
        title: '합성 영상',
        extractor: 'youtube',
        extractor_key: 'Youtube',
        webpage_url: youtube,
        availability: 'public',
        age_limit: 0,
        live_status: 'not_live',
        duration: 10,
        vcodec: 'h264',
        acodec: 'aac',
        formats: [
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

async function fake(request: EngineProcessRequest) {
    calls.push(request)

    if (request.executable === nodeExecutable) {
        return {
            stdout: 'v24.22.0',
            stderr: ''
        }
    }

    if (request.executable === binaries.ffmpeg) {
        return {
            stdout: 'ffmpeg version synthetic',
            stderr: ''
        }
    }

    const gallery = request.executable === binaries.galleryDl

    if (request.arguments.includes('--version')) {
        return {
            stdout: gallery ? galleryVersion : YTDLP_VERSION,
            stderr: ''
        }
    }

    if (gallery && request.arguments.includes('-J')) {
        const original = request.arguments.at(-1)!

        const shortcode = new URL(original).pathname.split('/')[2]

        const extension = galleryType === 'GraphVideo' ? 'mp4' : 'jpg'

        const metadata = {
            category: 'instagram',
            subcategory: 'post',
            typename: galleryType,
            post_shortcode: wrongSource ? 'OtherPost' : shortcode,
            post_id: mediaId,
            media_id: mediaId,
            owner_id: '123',
            username: 'fixture',
            count: '1',
            extension
        }

        return {
            stdout: JSON.stringify([
                [2, metadata],
                [3, 'https://example.invalid/original.' + extension, metadata]
            ]),
            stderr: diagnostics
        }
    }

    if (!gallery && request.arguments.includes('--dump-single-json')) {
        return {
            stdout: JSON.stringify(youtubeDocument()),
            stderr: ''
        }
    }

    const flag = gallery ? '-f' : '--output'
    const index = request.arguments.indexOf(flag)

    if (index < 0) {
        throw new Error('UNEXPECTED_ENGINE_REQUEST')
    }

    const name = request.arguments[index + 1].replace('%(ext)s', 'mp4')

    const outputPath: string = testPath(root, request.cwd, name)

    stagedPath = outputPath

    await writeFile(outputPath, bytes, { flag: 'wx' })

    if (gallery && downloadFailure) {
        throw new DownloadRepositoryError(downloadFailure)
    }

    return {
        stdout: gallery ? '' : JSON.stringify(outputPath) + '\n',
        stderr: ''
    }
}

function runtime(getGalleryDlAuthentication?: DownloadEngineOptions['getGalleryDlAuthentication']) {
    return createDownloadRuntime(db, {
        getStorageRoot: () => selectedRoot,

        engines: {
            getBinaries: () => binaries,
            getGalleryDlAuthentication,
            hostScript: testPath(root, 'engine-host.ps1'),
            nodeExecutable,
            workingDirectory: root,
            engine: { run: fake }
        }
    })
}

function mediaCount(): number {
    return sqlite!.prepare('SELECT count(*) FROM media_file').pluck().get() as number
}

beforeEach(() => {
    root = createTestWorkspace('download-engine-routing')
    selectedRoot = root

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...schemaV2Sql, ...schemaV2Guards, ...downloadStorageSql]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })

    binaries = {
        ytDlp: testPath(root, 'bin', 'yt-dlp.exe'),
        ffmpeg: testPath(root, 'bin', 'ffmpeg.exe'),
        galleryDl: testPath(root, 'bin', 'gallery-dl.exe')
    }

    nodeExecutable = testPath(root, 'bin', 'node.exe')

    calls = []
    galleryType = 'GraphImage'
    diagnostics = ''
    wrongSource = false
    galleryVersion = GALLERYDL_VERSION
    stagedPath = undefined
    downloadFailure = undefined
})

afterEach(() => {
    try {
        if (sqlite?.open) {
            expect(sqlite.pragma('foreign_key_check')).toEqual([])
        }
    } finally {
        sqlite?.close()
        sqlite = undefined
        cleanupTestWorkspace(root)
    }
})

describe('공통 다운로드 런타임의 엔진 라우팅', () => {
    it.each(['GraphImage', 'GraphVideo'])(
        'Instagram %s를 gallery-dl로 저장하고 커밋한다',
        async (type) => {
            galleryType = type

            const inputUrl = type === 'GraphVideo' ? instagram.replace('/p/', '/reel/') : instagram

            const service = runtime().service

            const job = data(
                await service.enqueue({
                    mode: 'create',
                    url: inputUrl
                })
            )

            const result = data(
                await service.run({
                    jobId: job.id,
                    trigger: 'manual_initial'
                })
            )

            expect(result.status).toBe('committed')
            expect(mediaCount()).toBe(1)

            expect(calls.every((call) => call.executable === binaries.galleryDl)).toBe(true)

            const file = sqlite!
                .prepare(
                    'SELECT file_key AS fileKey, kind, ' +
                        'filepath, content_hash AS contentHash ' +
                        'FROM media_file'
                )
                .get() as {
                fileKey: string
                kind: string
                filepath: string
                contentHash: string
            }

            expect(file.fileKey).toBe('instagram:' + mediaId + ':' + mediaId)

            expect(file.kind).toBe(type === 'GraphVideo' ? 'video' : 'image')

            expect(await readFile(testPath(root, file.filepath))).toEqual(bytes)

            expect(file.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'))

            expect(calls.filter((call) => call.arguments.includes('-J'))).toHaveLength(1)

            const download = calls.find((call) => call.arguments.includes('-f'))!

            expect(download.arguments).toContain('extractor.modules=["directlink"]')

            expect(download.arguments).not.toContain(inputUrl)
        }
    )

    it('인증 설정은 등록 시 읽지 않고 실행의 조회 단계에만 한 번 전달한다', async () => {
        const cookieA = testPath(root, 'cookies-a.txt')
        const cookieB = testPath(root, 'cookies-b.txt')
        const cookieText =
            '# Netscape HTTP Cookie File\n' +
            '.instagram.com\tTRUE\t/\tTRUE\t2147483647\tsessionid\tsynthetic-session\n'

        await writeFile(cookieA, cookieText, { flag: 'wx' })
        await writeFile(cookieB, cookieText, { flag: 'wx' })

        let reads = 0

        const service = runtime(() => ({
            cookieFilePath: ++reads === 1 ? cookieA : cookieB
        })).service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        expect(reads).toBe(0)

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('committed')
        expect(reads).toBe(1)

        const discovery = calls.filter((call) => call.arguments.includes('-J'))

        expect(discovery).toHaveLength(1)
        expect(discovery[0].arguments).toContain('cookies=' + JSON.stringify(cookieA))

        for (const call of calls.filter((call) => !call.arguments.includes('-J'))) {
            expect(call.arguments.join('\n')).not.toContain(cookieA)
            expect(call.arguments.join('\n')).not.toContain(cookieB)
        }

        for (const call of calls.filter((call) => call.arguments.includes('-f'))) {
            expect(call.arguments).toContain('cookies=null')
            expect(call.arguments).toContain('cookies-update=false')
        }

        const saved = new DownloadRepository(db).get(job.id)!

        expect(saved.optionsJson).not.toContain(cookieA)
        expect(saved.optionsJson).not.toContain('synthetic-session')
        expect(await readFile(cookieA, 'utf8')).toBe(cookieText)
    })

    it('YouTube 실행에서는 gallery-dl 인증 설정을 읽지 않는다', async () => {
        const service = runtime(() => {
            throw new Error('gallery-dl 인증 설정을 읽으면 안 됩니다.')
        }).service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: youtube
            })
        )

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('committed')
    })

    it('지정한 쿠키 파일이 없으면 무인증 조회로 진행하지 않는다', async () => {
        const service = runtime(() => ({
            cookieFilePath: testPath(root, 'missing-cookies.txt')
        })).service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('cleanup_required')
        expect(new DownloadRepository(db).get(job.id)!.errorCode).toBe('FILE_IO_ERROR')
        expect(calls.some((call) => call.arguments.includes('-J'))).toBe(false)
        expect(calls.some((call) => call.arguments.includes('-f'))).toBe(false)
        expect(mediaCount()).toBe(0)
    })

    it('YouTube는 공통 진입점에서도 yt-dlp로 커밋한다', async () => {
        const service = runtime().service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: youtube
            })
        )

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('committed')
        expect(mediaCount()).toBe(1)

        expect(calls.some((call) => call.executable === binaries.galleryDl)).toBe(false)

        expect(calls.filter((call) => call.arguments.includes('--dump-single-json'))).toHaveLength(
            1
        )

        expect(calls.some((call) => call.arguments.includes('--load-info-json'))).toBe(true)
    })

    it.each(['캐러셀', '진단 메시지', '다른 게시물'])(
        '%s 결과는 다운로드와 미디어 커밋을 막는다',
        async (condition) => {
            if (condition === '캐러셀') {
                galleryType = 'GraphSidecar'
            }

            if (condition === '진단 메시지') {
                diagnostics = 'fixture warning'
            }

            if (condition === '다른 게시물') {
                wrongSource = true
            }

            const service = runtime().service

            const job = data(
                await service.enqueue({
                    mode: 'create',
                    url: instagram
                })
            )

            const result = data(
                await service.run({
                    jobId: job.id,
                    trigger: 'manual_initial'
                })
            )

            expect(result.status).toBe('cleanup_required')

            expect(mediaCount()).toBe(0)

            expect(calls.some((call) => call.arguments.includes('-f'))).toBe(false)
        }
    )

    it('파일을 쓰다가 엔진이 실패하면 커밋하지 않는다', async () => {
        downloadFailure = 'DOWNLOAD_ENGINE_FAILED'

        const service = runtime().service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(result.status).toBe('cleanup_required')

        expect(mediaCount()).toBe(0)
        expect(stagedPath).toBeDefined()

        expect(existsSync(testPath(root, stagedPath!))).toBe(true)
    })

    it('종료 미확인 시 정리와 후속 엔진 실행을 막는다', async () => {
        // 실제 프로세스를 만들지 않고 응답만 재현한다.
        downloadFailure = 'ENGINE_STOP_UNCONFIRMED'

        const service = runtime().service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        const first = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        expect(first.status).toBe('blocked')
        expect(mediaCount()).toBe(0)

        expect(existsSync(testPath(root, stagedPath!))).toBe(true)

        expect(
            sqlite!
                .prepare(
                    'SELECT count(*) FROM maintenance_task ' + "WHERE kind = 'rollback_cleanup'"
                )
                .pluck()
                .get()
        ).toBe(0)

        const previousCalls = calls.length

        const second = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_retry'
            })
        )

        expect(second.status).toBe('blocked')
        expect(calls).toHaveLength(previousCalls)

        expect(existsSync(testPath(root, stagedPath!))).toBe(true)
    })

    it('저장 설정이 바뀌어도 작업별 경로를 유지한다', async () => {
        const rootA = testPath(root, 'A')
        const rootB = testPath(root, 'B')

        await mkdir(rootA)
        await mkdir(rootB)

        selectedRoot = rootA

        const service = runtime().service

        const old = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        selectedRoot = rootB

        const added = data(
            await service.enqueue({
                mode: 'create',
                url: instagram.replace('Synthetic01', 'Synthetic02')
            })
        )

        expect(
            data(
                await service.run({
                    jobId: old.id,
                    trigger: 'manual_initial'
                })
            ).status
        ).toBe('committed')

        expect(
            data(
                await service.run({
                    jobId: added.id,
                    trigger: 'manual_initial'
                })
            ).status
        ).toBe('committed')

        const files = sqlite!.prepare('SELECT filepath FROM media_file ORDER BY id').all() as {
            filepath: string
        }[]

        expect(files).toHaveLength(2)

        expect(files[0].filepath.startsWith(rootA + sep)).toBe(true)

        expect(files[1].filepath.startsWith(rootB + sep)).toBe(true)
    })

    it('다른 gallery-dl 버전은 조회 전에 거부한다', async () => {
        galleryVersion = 'unsupported'

        const service = runtime().service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        const result = await service.run({
            jobId: job.id,
            trigger: 'manual_initial'
        })

        expect(result.ok).toBe(false)

        if (result.ok) {
            throw new Error('EXPECTED_FAILURE')
        }

        expect(result.error.code).toBe('UNSUPPORTED_TARGET_DISCOVERY')

        expect(calls).toHaveLength(1)
        expect(calls[0].arguments).toContain('--version')

        expect(mediaCount()).toBe(0)
    })

    it('미지원 URL은 DB 등록과 엔진 실행 전에 거부한다', async () => {
        const service = runtime().service

        const result = await service.enqueue({
            mode: 'create',
            url: 'https://example.invalid/post'
        })

        expect(result.ok).toBe(false)

        expect(sqlite!.prepare('SELECT count(*) FROM download_queue').pluck().get()).toBe(0)

        expect(calls).toEqual([])
    })

    it('시작 시 미완료 시도가 있으면 자동 실행하지 않는다', async () => {
        const service = runtime().service

        const job = data(
            await service.enqueue({
                mode: 'create',
                url: instagram
            })
        )

        new DownloadRepository(db).startAttempt(job.id, 'manual_initial')

        const restored = runtime().service

        const result = await restored.enqueue({
            mode: 'create',
            url: instagram.replace('Synthetic01', 'Synthetic02')
        })

        expect(result.ok).toBe(false)

        if (result.ok) {
            throw new Error('EXPECTED_FAILURE')
        }

        expect(result.error.code).toBe('ENGINE_STOP_UNCONFIRMED')

        expect(calls).toEqual([])
    })
})
