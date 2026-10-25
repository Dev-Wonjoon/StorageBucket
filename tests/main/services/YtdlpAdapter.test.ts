import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'
import { YtdlpAdapter, type YtdlpDiscoveryPolicy } from '../../../src/main/services/YtdlpAdapter'
import { EngineProcess, type EngineProcessRequest } from '../../../src/main/services/EngineProcess'
import { DownloadRepositoryError } from '../../../src/main/repositories/DownloadRepository'
import type { FrozenDownloadTarget } from '../../../src/main/services/DownloadAdapter'
import { downloadStagingDirectory } from '../../../src/main/services/DownloadVerificationService'

let root: string
let stage: string
let calls: EngineProcessRequest[]
let document: Record<string, unknown>
let adapter: YtdlpAdapter

const context = () => ({
    jobId: 'job',
    attemptId: 'attempt',
    stagingDirectory: stage,
    options: {},
    signal: new AbortController().signal
})

const policy: YtdlpDiscoveryPolicy = {
    accepts: (url) => url === 'https://example.invalid/page',

    identify: (_document, rows) =>
        rows.every((row) => row.extractor_key === 'Fixture')
            ? rows.map((row) => 'fixture:' + row.id)
            : undefined
}

function leaf(id = 'a') {
    return {
        _type: 'video',
        id,
        title: 'title ' + id,
        extractor_key: 'Fixture',
        webpage_url: 'https://example.invalid/item/' + id,
        url: 'https://example.invalid/' + id + '.mp4',
        ext: 'mp4',
        vcodec: 'h264',
        acodec: 'aac',
        duration: 1
    }
}

function error(code: string) {
    return (value: unknown) => value instanceof DownloadRepositoryError && value.code === code
}

async function discover() {
    const rows = await adapter.discover({
        ...context(),
        originalUrl: 'https://example.invalid/page'
    })

    return rows.map((row, position): FrozenDownloadTarget => ({
        ...row,
        id: 'target-' + position,
        position
    }))
}

async function fake(request: EngineProcessRequest) {
    calls.push(request)

    if (request.arguments.includes('--version')) {
        return { stdout: '2026.03.17\n', stderr: '' }
    }

    if (request.arguments.includes('--dump-single-json')) {
        return {
            stdout: JSON.stringify(document),
            stderr: ''
        }
    }

    const index = request.arguments.indexOf('--output')

    const path = join(stage, request.arguments[index + 1].replace('%(ext)s', 'mp4'))

    await writeFile(path, 'fixture bytes', { flag: 'wx' })

    return {
        stdout: JSON.stringify(path) + '\n',
        stderr: ''
    }
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storagebucket-ytdlp-한글-'))

    stage = downloadStagingDirectory(root, 'job', 'attempt')

    await mkdir(stage, { recursive: true })

    calls = []
    document = leaf()

    adapter = new YtdlpAdapter(
        { run: fake },
        root,
        resolve('bin/yt-dlp.exe'),
        resolve('bin/ffmpeg.exe'),
        policy
    )
})

afterEach(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('storagebucket-ytdlp-'))

    await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 50
    })
})

describe('YtdlpAdapter', () => {
    it('DB 고정 대상과 대조하고 원 URL 없는 JSON으로 실행한다', async () => {
        const targets = await discover()
        const results = await adapter.downloadFrozen({
            ...context(),
            targets
        })

        assert.equal(results.length, 1)
        assert.equal(results[0].targetKey, 'fixture:a')

        const request = calls.find((call) => call.arguments.includes('--load-info-json'))!

        const info = JSON.parse(request.input!)

        assert.equal(info.webpage_url, undefined)
        assert.equal(info.original_url, undefined)
        assert.equal(info._type, 'video')
        assert.equal(info.formats[0].url, 'https://example.invalid/a.mp4')

        assert.ok(!request.arguments.includes('https://example.invalid/page'))

        assert.deepEqual(await readdir(stage), [basename(results[0].stagedPath)])
    })

    it('중첩 목록을 순서대로 펼치되 중복 키는 거부한다', async () => {
        document = {
            _type: 'playlist',
            playlist_count: 2,
            entries: [
                leaf('a'),
                {
                    _type: 'multi_video',
                    entries: [leaf('b')]
                }
            ]
        }

        assert.deepEqual(
            (await discover()).map((row) => row.targetKey),
            ['fixture:a', 'fixture:b']
        )

        document = {
            _type: 'playlist',
            entries: [leaf('a'), leaf('a')]
        }

        await assert.rejects(discover(), error('TARGET_DUPLICATE'))
    })

    it.each([
        {
            _type: 'url',
            url: 'https://example.invalid/next'
        },
        {
            _type: 'playlist',
            entries: [null]
        },
        { ...leaf(), is_live: true },
        { ...leaf(), has_drm: true },
        { ...leaf(), url: 'file:///secret' }
    ])('미해석 항목·빈 항목·라이브·DRM·비 HTTP 입력을 거부한다: %j', async (value) => {
        document = value

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))
    })

    it('빈 목록과 알려진 총수 불일치를 거부한다', async () => {
        document = {
            _type: 'playlist',
            entries: []
        }

        await assert.rejects(discover(), error('TARGET_DISCOVERY_EMPTY'))

        document = {
            _type: 'playlist',
            playlist_count: 2,
            entries: [leaf()]
        }

        await assert.rejects(discover(), error('TARGET_INCOMPLETE'))
    })

    it('미지원 요청은 프로세스를 실행하지 않는다', async () => {
        await assert.rejects(
            adapter.discover({
                ...context(),
                originalUrl: 'https://other.invalid'
            }),
            error('UNSUPPORTED_TARGET_DISCOVERY')
        )

        assert.equal(calls.length, 0)
    })

    it('정책이 승인하지 않은 추출기를 거부한다', async () => {
        document = {
            ...leaf(),
            extractor_key: 'Generic'
        }

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))

        assert.ok(!calls.some((call) => call.arguments.includes('--load-info-json')))
    })

    it('다른 엔진 버전은 발견을 시작하지 않는다', async () => {
        adapter = new YtdlpAdapter(
            {
                run: async (request) => {
                    calls.push(request)

                    return {
                        stdout: 'different-version',
                        stderr: ''
                    }
                }
            },
            root,
            resolve('bin/yt-dlp.exe'),
            resolve('bin/ffmpeg.exe'),
            policy
        )

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))

        assert.equal(calls.length, 1)
    })

    it('고정 후 옵션·대상·메타데이터가 바뀌면 실행하지 않는다', async () => {
        const targets = await discover()
        const before = calls.length

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets,
                options: { quality: '720' }
            }),
            error('VERIFICATION_CHANGED')
        )

        assert.equal(calls.length, before)

        const fresh = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets: [
                    {
                        ...fresh[0],
                        metadata: {
                            ...fresh[0].metadata,
                            title: 'changed'
                        }
                    }
                ]
            }),
            error('VERIFICATION_CHANGED')
        )

        const again = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets: [
                    {
                        ...again[0],
                        targetKey: 'other'
                    }
                ]
            }),
            error('VERIFICATION_CHANGED')
        )
    })

    it('반환 배열을 수정해도 내부 실행 스냅샷은 바뀌지 않는다', async () => {
        const targets = await discover()

        ;(targets[0].metadata as { title: string }).title = 'changed'

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets
            }),
            error('VERIFICATION_CHANGED')
        )
    })

    it('조회 없이 실행하거나 같은 스냅샷을 재사용하지 않는다', async () => {
        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets: []
            }),
            error('VERIFICATION_CHANGED')
        )

        const targets = await discover()

        await adapter.downloadFrozen({
            ...context(),
            targets
        })

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets
            }),
            error('VERIFICATION_CHANGED')
        )
    })

    it('원 URL 추가 요청과 내부 파일 경로 필드를 실행 JSON에서 제거한다', async () => {
        document = {
            ...leaf(),
            additional_urls: ['https://secret.invalid'],
            __files_to_move: { secret: 'outside' },
            filepath: 'outside',
            requested_downloads: [{ filepath: 'outside' }]
        }

        const targets = await discover()

        await adapter.downloadFrozen({
            ...context(),
            targets
        })

        const info = JSON.parse(calls.find((call) => call.input)!.input!)

        for (const field of [
            'webpage_url',
            'additional_urls',
            '__files_to_move',
            'filepath',
            'requested_downloads'
        ]) {
            assert.equal(info[field], undefined)
        }
    })

    it('기존 staging 내용은 덮어쓰지 않는다', async () => {
        await writeFile(join(stage, 'keep'), 'original')

        await assert.rejects(discover(), error('UNSAFE_STAGING_PATH'))

        assert.equal(calls.length, 0)

        assert.equal(await readFile(join(stage, 'keep'), 'utf8'), 'original')
    })

    it('결과에 추가 파일이 있으면 전체 성공으로 반환하지 않는다', async () => {
        adapter = new YtdlpAdapter(
            {
                run: async (request) => {
                    const result = await fake(request)

                    if (request.input) {
                        await writeFile(join(stage, 'extra.jpg'), 'extra')
                    }

                    return result
                }
            },
            root,
            resolve('bin/yt-dlp.exe'),
            resolve('bin/ffmpeg.exe'),
            policy
        )

        const targets = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets
            }),
            error('TARGET_UNEXPECTED_RESULT')
        )
    })

    it('종료 미확인을 보존하고 같은 어댑터의 후속 실행을 막는다', async () => {
        adapter = new YtdlpAdapter(
            {
                run: async () => {
                    throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
                }
            },
            root,
            resolve('bin/yt-dlp.exe'),
            resolve('bin/ffmpeg.exe'),
            policy
        )

        await assert.rejects(discover(), error('ENGINE_STOP_UNCONFIRMED'))

        await assert.rejects(discover(), error('ENGINE_STOP_UNCONFIRMED'))
    })

    it('취소된 요청은 실행하지 않는다', async () => {
        const controller = new AbortController()
        controller.abort()

        await assert.rejects(
            adapter.discover({
                ...context(),
                originalUrl: 'https://example.invalid/page',
                signal: controller.signal
            }),
            error('CANCEL_REQUESTED')
        )

        assert.equal(calls.length, 0)
    })
})

describe.skipIf(process.platform !== 'win32')('YtdlpAdapter 실제 엔진', () => {
    let server: Server | undefined
    let requests: string[]
    let base: string
    let media: Buffer
    let broken: boolean
    let changed: boolean

    afterEach(async () => {
        if (server) {
            const current = server
            server = undefined

            current.closeAllConnections()

            await new Promise<void>((done, reject) => {
                current.close((error) => (error ? reject(error) : done()))
            })
        }
    })

    async function prepare(
        settings: {
            type?: 'audio'
            extension?: 'mp3'
        } = {},
        merge = false
    ) {
        const engine = new EngineProcess(resolve('resources/engine-host.ps1'))

        const source = join(root, 'source.mp4')

        await engine.run({
            executable: resolve('bin/ffmpeg.exe'),
            cwd: root,
            arguments: [
                '-hide_banner',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'color=c=red:s=16x16:r=5',
                '-f',
                'lavfi',
                '-i',
                'sine=frequency=400:sample_rate=8000',
                '-t',
                '0.2',
                '-c:v',
                'libx264',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-shortest',
                '-y',
                source
            ],
            timeoutMs: 30_000
        })

        media = await readFile(source)
        requests = []
        broken = false
        changed = false

        server = createServer((request, response) => {
            requests.push(request.method + ' ' + request.url)

            if (request.url === '/page') {
                response.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8'
                })

                response.end(
                    '<title>fixture</title><video src="/' +
                        (changed ? 'changed.mp4' : 'media.mp4') +
                        '" controls></video>'
                )
            } else if (request.url?.split('?')[0] === '/media.mp4' && !broken) {
                response.writeHead(200, {
                    'Content-Type': 'video/mp4',
                    'Content-Length': media.length
                })

                response.end(request.method === 'HEAD' ? undefined : media)
            } else {
                response.writeHead(404)
                response.end()
            }
        })

        await new Promise<void>((done) => {
            server!.listen(0, '127.0.0.1', done)
        })

        base = 'http://127.0.0.1:' + (server.address() as { port: number }).port

        // 이 로컬 합성 자료에만 사용하는 정책이다.
        // 순번 기반 추출기 ID는 영구 키로 사용하지 않는다.
        const localPolicy: YtdlpDiscoveryPolicy = {
            accepts: (url) => url === base + '/page',

            identify: (_doc, rows) =>
                rows.length === 1 &&
                rows[0].extractor_key === 'HTML5MediaEmbed' &&
                rows[0].url === base + '/media.mp4'
                    ? ['local-fixture:media']
                    : undefined
        }

        adapter = new YtdlpAdapter(
            {
                async run(request) {
                    const output = await engine.run(request)

                    if (merge && request.arguments.includes('--dump-single-json')) {
                        const parsed = JSON.parse(output.stdout)
                        const item = parsed.entries ? parsed.entries[0] : parsed

                        const source = item.formats[0]

                        item.formats = [
                            {
                                ...source,
                                url: base + '/media.mp4?stream=video',
                                format_id: 'video',
                                vcodec: 'h264',
                                acodec: 'none'
                            },
                            {
                                ...source,
                                url: base + '/media.mp4?stream=audio',
                                format_id: 'audio',
                                vcodec: 'none',
                                acodec: 'aac'
                            }
                        ]

                        return {
                            ...output,
                            stdout: JSON.stringify(parsed)
                        }
                    }

                    return output
                }
            },
            root,
            resolve('bin/yt-dlp.exe'),
            resolve('bin/ffmpeg.exe'),
            localPolicy
        )

        const rows = await adapter.discover({
            ...context(),
            options: settings,
            originalUrl: base + '/page'
        })

        assert.equal(requests.filter((value) => value === 'GET /media.mp4').length, 0)

        const targets = rows.map((row, position) => ({
            ...row,
            id: 'target-' + position,
            position
        }))

        return { engine, targets }
    }

    it('원 페이지가 바뀌어도 고정한 파일만 내려받고 해시가 일치한다', async () => {
        const { targets } = await prepare()

        const before = requests.filter((value) => value === 'GET /page').length

        changed = true

        const results = await adapter.downloadFrozen({
            ...context(),
            targets
        })

        const actual = await readFile(results[0].stagedPath)

        const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

        assert.equal(hash(actual), hash(media))

        assert.equal(requests.filter((value) => value === 'GET /page').length, before)

        assert.ok(!requests.some((value) => value.includes('changed.mp4')))
    }, 60_000)

    it('고정 URL이 실패해도 원 페이지를 다시 추출하지 않는다', async () => {
        const { targets } = await prepare()

        const before = requests.filter((value) => value === 'GET /page').length

        broken = true
        changed = true

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets
            }),
            error('DOWNLOAD_ENGINE_FAILED')
        )

        assert.equal(requests.filter((value) => value === 'GET /page').length, before)

        assert.ok(!requests.some((value) => value.includes('changed.mp4')))
    }, 60_000)

    it('실제 ffmpeg로 MP3를 만들고 오디오를 읽을 수 있다', async () => {
        const settings = {
            type: 'audio' as const,
            extension: 'mp3' as const
        }

        const { engine, targets } = await prepare(settings)

        const before = requests.filter((value) => value === 'GET /page').length

        const results = await adapter.downloadFrozen({
            ...context(),
            options: settings,
            targets
        })

        assert.equal(targets[0].metadata.kind, 'audio')
        assert.ok(results[0].stagedPath.endsWith('.mp3'))

        await engine.run({
            executable: resolve('bin/ffmpeg.exe'),
            cwd: root,
            arguments: [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                results[0].stagedPath,
                '-map',
                '0:a:0',
                '-f',
                'null',
                '-'
            ]
        })

        assert.equal(requests.filter((value) => value === 'GET /page').length, before)
    }, 60_000)

    it('합성 영상·음성 포맷을 실제 병합하고 두 스트림을 읽을 수 있다', async () => {
        const { engine, targets } = await prepare({}, true)

        const results = await adapter.downloadFrozen({
            ...context(),
            targets
        })

        assert.ok(requests.includes('GET /media.mp4?stream=video'))

        assert.ok(requests.includes('GET /media.mp4?stream=audio'))

        await engine.run({
            executable: resolve('bin/ffmpeg.exe'),
            cwd: root,
            arguments: [
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                results[0].stagedPath,
                '-map',
                '0:v:0',
                '-map',
                '0:a:0',
                '-f',
                'null',
                '-'
            ]
        })
    }, 60_000)
})
