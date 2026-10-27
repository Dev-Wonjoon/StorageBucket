import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'
import {
    GalleryDlAdapter,
    type GalleryDlDiscoveryPolicy
} from '../../../src/main/features/download/GalleryDlAdapter'
import {
    EngineProcess,
    type EngineProcessRequest,
    type EngineProcessResult
} from '../../../src/main/features/download/EngineProcess'
import {
    DownloadRepositoryError,
    type DownloadTargetInput
} from '@features/download/DownloadRepository'
import type { FrozenDownloadTarget } from '@features/download/DownloadAdapter'
import { downloadStagingDirectory } from '@features/download/DownloadVerificationService'
import {
    createTestWorkspace,
    cleanupTestWorkspace,
    requireTestWorkspace,
    testPath
} from '../../helpers/test-workspace.cjs'

requireTestWorkspace()

let workspace: string | undefined
let controller: AbortController | undefined
let realEngineHalted = false

const pendingProcesses = new Set<Promise<EngineProcessResult>>()

function fixturePath(...segments: string[]): string {
    if (!workspace) {
        throw new Error('TEST_WORKSPACE_NOT_READY')
    }

    return testPath(workspace, ...segments)
}

let root: string
let stage: string
let adapter: GalleryDlAdapter
let calls: EngineProcessRequest[]
let messages: unknown[]

const context = () => ({
    jobId: 'job',
    attemptId: 'attempt',
    stagingDirectory: stage,
    options: {},
    signal: controller!.signal
})

const item = (num: number) => [
    3,
    'https://example.invalid/' + num + '.png',
    {
        category: 'fixture',
        post_id: 1,
        num,
        extension: 'png'
    }
]

const policy: GalleryDlDiscoveryPolicy = {
    accepts: (url) => url === 'https://example.invalid/post',

    identify: (_messages, files) =>
        files.every((file) => file.metadata.category === 'fixture')
            ? files.map((file) => ({
                  targetKey: 'fixture:' + file.metadata.post_id + ':' + file.metadata.num,
                  sourceUrl: 'https://example.invalid/post',
                  metadata: {
                      kind: 'image',
                      title: 'fixture'
                  }
              }))
            : undefined
}

const error = (code: string) => (value: unknown) =>
    value instanceof DownloadRepositoryError && value.code === code

async function fake(request: EngineProcessRequest) {
    calls.push(request)

    if (request.arguments.includes('--version')) {
        return { stdout: '1.32.1\n', stderr: '' }
    }

    if (request.arguments.includes('-J')) {
        return {
            stdout: JSON.stringify(messages),
            stderr: ''
        }
    }

    const name = request.arguments[request.arguments.indexOf('-f') + 1]

    await writeFile(fixturePath(stage, name), 'fixture', { flag: 'wx' })

    return { stdout: '', stderr: '' }
}

async function discover() {
    const rows = await adapter.discover({
        ...context(),
        originalUrl: 'https://example.invalid/post'
    })

    return rows.map((row, position): FrozenDownloadTarget => ({
        ...row,
        id: 'id-' + position,
        position
    }))
}

async function runTrackedEngine(
    engine: EngineProcess,
    request: EngineProcessRequest
): Promise<EngineProcessResult> {
    if (!controller) {
        throw new Error('TEST_WORKSPACE_NOT_READY')
    }

    fixturePath(request.cwd)

    const operation = engine.run({
        ...request,
        signal: request.signal ?? controller.signal,
        timeoutMs: Math.min(request.timeoutMs ?? 30_000, 30_000),
        stopGraceMs: 5_000
    })

    pendingProcesses.add(operation)

    try {
        return await operation
    } catch (error) {
        if (
            !(error instanceof DownloadRepositoryError) ||
            error.code === 'ENGINE_STOP_UNCONFIRMED'
        ) {
            realEngineHalted = true
        }

        throw error
    } finally {
        pendingProcesses.delete(operation)
    }
}

beforeEach(async () => {
    workspace = undefined
    controller = undefined

    if (realEngineHalted) {
        throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
    }

    workspace = createTestWorkspace('gallery-dl-adapter')
    controller = new AbortController()

    root = fixturePath('한글-저장소')
    await mkdir(root)

    stage = fixturePath(downloadStagingDirectory(root, 'job', 'attempt'))

    await mkdir(stage, { recursive: true })

    calls = []
    messages = [[2, { category: 'fixture' }], item(1), item(2)]

    adapter = new GalleryDlAdapter({ run: fake }, root, resolve('bin/gallery-dl.exe'), policy)
})

afterEach(async () => {
    const owned = workspace

    if (!owned) return

    controller?.abort()

    await Promise.allSettled([...pendingProcesses])

    workspace = undefined

    if (realEngineHalted) {
        process.stderr.write('엔진 종료 미확인으로 테스트 자료를 보존합니다: ' + owned + '\n')
        return
    }

    cleanupTestWorkspace(owned)
})

describe('GalleryDlAdapter', () => {
    it('인증 객체가 바뀌어도 선택한 파일은 유지하고 직접 다운로드에는 전달하지 않는다', async () => {
        const cookiePath = fixturePath('cookies.txt')
        const cookieText =
            '# Netscape HTTP Cookie File\n' +
            '.example.invalid\tTRUE\t/\tTRUE\t2147483647\tsessionid\tsynthetic-session\n'

        await writeFile(cookiePath, cookieText, { flag: 'wx' })

        const authentication = { cookieFilePath: cookiePath }

        adapter = new GalleryDlAdapter(
            { run: fake },
            root,
            resolve('bin/gallery-dl.exe'),
            policy,
            authentication
        )

        authentication.cookieFilePath = fixturePath('changed-cookies.txt')

        const targets = await discover()
        await adapter.downloadFrozen({ ...context(), targets })

        const discovery = calls.find((call) => call.arguments.includes('-J'))!

        assert.ok(discovery.arguments.includes('cookies=' + JSON.stringify(cookiePath)))
        assert.ok(discovery.arguments.includes('cookies-update=false'))
        assert.ok(!discovery.arguments.join('\n').includes('synthetic-session'))

        for (const call of calls.filter((call) => call.arguments.includes('-f'))) {
            assert.ok(call.arguments.includes('cookies=null'))
            assert.ok(!call.arguments.join('\n').includes(cookiePath))
        }

        assert.equal(await readFile(cookiePath, 'utf8'), cookieText)
    })

    it.each(['relative-cookies.txt', 'invalid\0cookies.txt'])(
        '잘못된 인증 경로는 외부 실행 전에 거부한다: %j',
        (cookieFilePath) => {
            assert.throws(
                () =>
                    new GalleryDlAdapter(
                        { run: fake },
                        root,
                        resolve('bin/gallery-dl.exe'),
                        policy,
                        { cookieFilePath }
                    ),
                error('INVALID_ARGUMENT')
            )

            assert.equal(calls.length, 0)
        }
    )

    it('한 부모의 두 파일을 구분하고 directlink 모듈로만 실행한다', async () => {
        const targets = await discover()

        const results = await adapter.downloadFrozen({
            ...context(),
            targets
        })

        assert.deepEqual(
            results.map((row) => row.targetKey),
            ['fixture:1:1', 'fixture:1:2']
        )

        const downloads = calls.filter((call) => call.arguments.includes('-f'))

        assert.equal(downloads.length, 2)

        for (const call of downloads) {
            assert.ok(call.arguments.includes('extractor.modules=["directlink"]'))

            assert.ok(!call.arguments.includes('https://example.invalid/post'))

            assert.ok(call.arguments.includes('cache.file=null'))

            assert.ok(call.arguments.includes('cookies=null'))

            assert.ok(call.arguments.includes('postprocessors=[]'))
        }
    })

    it('종료 코드가 0이어도 JSON 오류 메시지가 있으면 거부한다', async () => {
        messages.push([-1, { error: 'ValueError', message: 'secret' }])

        await assert.rejects(discover(), error('TARGET_INCOMPLETE'))

        assert.ok(!calls.some((call) => call.arguments.includes('-f')))
    })

    it.each([
        [[6, 'https://example.invalid/child', {}]],
        [[1]],
        [[3, 'file:///secret', {}]],
        [[3, 'https://example.invalid/a.png']],
        [[2, null]]
    ])('미해결·알 수 없는·잘못된 메시지를 거부한다: %j', async (value) => {
        messages = value

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))
    })

    it('빈 목록과 중복 영구 키를 거부한다', async () => {
        messages = []

        await assert.rejects(discover(), error('TARGET_DISCOVERY_EMPTY'))

        messages = [item(1), item(1)]

        await assert.rejects(discover(), error('TARGET_DUPLICATE'))
    })

    it('미지원 요청과 변환 옵션은 외부 실행 전에 거부한다', async () => {
        await assert.rejects(
            adapter.discover({
                ...context(),
                originalUrl: 'https://other.invalid'
            }),
            error('UNSUPPORTED_TARGET_DISCOVERY')
        )

        await assert.rejects(
            adapter.discover({
                ...context(),
                originalUrl: 'https://example.invalid/post',
                options: { quality: '720' }
            }),
            error('UNSUPPORTED_TARGET_DISCOVERY')
        )

        assert.equal(calls.length, 0)
    })

    it('확인하지 않은 파일 형식과 대체 URL은 실행하지 않는다', async () => {
        messages = [
            [
                3,
                'https://example.invalid/a.zip',
                {
                    category: 'fixture',
                    post_id: 1,
                    num: 1,
                    extension: 'zip'
                }
            ]
        ]

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))

        messages = [
            [
                3,
                'https://example.invalid/a.png',
                {
                    category: 'fixture',
                    post_id: 1,
                    num: 1,
                    _fallback: ['https://other.invalid/a.png']
                }
            ]
        ]

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))
    })

    it('다른 버전은 발견 전에 거부한다', async () => {
        adapter = new GalleryDlAdapter(
            {
                run: async (request) => {
                    calls.push(request)
                    return { stdout: 'other', stderr: '' }
                }
            },
            root,
            resolve('bin/gallery-dl.exe'),
            policy
        )

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))

        assert.equal(calls.length, 1)
    })

    it('조회 없이 실행하거나 대상·옵션을 바꾸지 못한다', async () => {
        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets: []
            }),
            error('VERIFICATION_CHANGED')
        )

        let targets = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets: [{ ...targets[0], targetKey: 'changed' }, targets[1]]
            }),
            error('VERIFICATION_CHANGED')
        )

        targets = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets,
                options: { playlist: true }
            }),
            error('VERIFICATION_CHANGED')
        )
    })

    it('반환 메타데이터를 수정해도 스냅샷은 바뀌지 않는다', async () => {
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

    it('기존 파일을 덮어쓰지 않는다', async () => {
        await writeFile(fixturePath(stage, 'keep'), 'original')

        await assert.rejects(discover(), error('UNSAFE_STAGING_PATH'))

        assert.equal(calls.length, 0)

        assert.equal(await readFile(fixturePath(stage, 'keep'), 'utf8'), 'original')
    })

    it('추가 결과 파일은 전체 성공으로 반환하지 않는다', async () => {
        adapter = new GalleryDlAdapter(
            {
                run: async (request) => {
                    const result = await fake(request)

                    if (request.arguments.includes('-f')) {
                        await writeFile(fixturePath(stage, 'extra'), 'extra')
                    }

                    return result
                }
            },
            root,
            resolve('bin/gallery-dl.exe'),
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

    it('종료 미확인은 보존하고 후속 실행을 막는다', async () => {
        adapter = new GalleryDlAdapter(
            {
                run: async () => {
                    throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
                }
            },
            root,
            resolve('bin/gallery-dl.exe'),
            policy
        )

        await assert.rejects(discover(), error('ENGINE_STOP_UNCONFIRMED'))

        await assert.rejects(discover(), error('ENGINE_STOP_UNCONFIRMED'))
    })

    it('HTTP 헤더의 줄바꿈 주입을 거부한다', async () => {
        messages = [
            [
                3,
                'https://example.invalid/a.png',
                {
                    category: 'fixture',
                    post_id: 1,
                    num: 1,
                    _http_headers: {
                        Referer: 'https://example.invalid/\r\nX-Injected: yes'
                    }
                }
            ]
        ]

        await assert.rejects(discover(), error('UNSUPPORTED_TARGET_DISCOVERY'))
    })

    it('종료 코드 0이어도 파일이 없으면 실패한다', async () => {
        adapter = new GalleryDlAdapter(
            {
                run: async (request) =>
                    request.arguments.includes('-f') ? { stdout: '', stderr: '' } : fake(request)
            },
            root,
            resolve('bin/gallery-dl.exe'),
            policy
        )

        const targets = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets
            }),
            error('FILE_IO_ERROR')
        )
    })

    it('0바이트 파일을 성공으로 반환하지 않는다', async () => {
        adapter = new GalleryDlAdapter(
            {
                run: async (request) => {
                    const result = await fake(request)

                    if (request.arguments.includes('-f')) {
                        const name = request.arguments[request.arguments.indexOf('-f') + 1]

                        await writeFile(fixturePath(stage, name), '')
                    }

                    return result
                }
            },
            root,
            resolve('bin/gallery-dl.exe'),
            policy
        )

        const targets = await discover()

        await assert.rejects(
            adapter.downloadFrozen({
                ...context(),
                targets
            }),
            error('FILE_EMPTY')
        )
    })

    it('취소된 요청은 실행하지 않는다', async () => {
        const controller = new AbortController()
        controller.abort()

        await assert.rejects(
            adapter.discover({
                ...context(),
                originalUrl: 'https://example.invalid/post',
                signal: controller.signal
            }),
            error('CANCEL_REQUESTED')
        )

        assert.equal(calls.length, 0)
    })
})

describe.skipIf(process.platform !== 'win32' || process.env.STORAGEBUCKET_GALLERYDL_SMOKE !== '1')(
    'GalleryDlAdapter 실제 엔진',
    () => {
        let server: Server | undefined
        let base: string
        let requests: string[]
        let broken: boolean
        let changed: boolean

        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            'base64'
        )

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

        async function prepare(mode = 'ok') {
            requests = []
            broken = false
            changed = false

            server = createServer((request, response) => {
                requests.push(request.method + ' ' + request.url)

                if (request.url?.startsWith('/post/')) {
                    response.writeHead(200, {
                        'Content-Type': 'application/json'
                    })

                    response.end(
                        JSON.stringify({
                            files: [
                                {
                                    num: 1,
                                    url: base + (changed ? '/changed.png' : '/a.png')
                                },
                                {
                                    num: 2,
                                    url: base + '/b.png'
                                }
                            ]
                        })
                    )
                } else if (
                    (request.url === '/a.png' || request.url === '/b.png') &&
                    !(broken && request.url === '/b.png') &&
                    request.headers['x-fixture'] === 'frozen' &&
                    request.headers.referer === base + '/post/' + mode
                ) {
                    response.writeHead(200, {
                        'Content-Type': 'image/png',
                        'Content-Length': png.length
                    })

                    response.end(png)
                } else {
                    response.writeHead(404)
                    response.end()
                }
            })

            await new Promise<void>((done) => {
                server!.listen(0, '127.0.0.1', done)
            })

            base = 'http://127.0.0.1:' + (server.address() as { port: number }).port

            const modules = fixturePath(root, 'modules')
            await mkdir(modules)

            await writeFile(
                fixturePath(modules, 'sbfixture.py'),
                `
from gallery_dl.extractor.common import Extractor, Message

class StorageBucketFixtureExtractor(Extractor):
    category = "sbfixture"
    subcategory = "post"
    pattern = r"http://127\\.0\\.0\\.1:[0-9]+/post/(ok|error)"

    def items(self):
        data = self.request(self.url).json()
        yield Message.Directory, "", {"post_id": 1}
        for item in data["files"]:
            yield Message.Url, item["url"], {
                "post_id": 1,
                "num": item["num"],
                "extension": "png",
                "_http_headers": {
                    "Referer": self.url,
                    "X-Fixture": "frozen"
                }
            }
            if self.url.endswith("/error"):
                raise ValueError("fixture extraction failure")
`,
                'utf8'
            )

            const engine = new EngineProcess(resolve('resources/engine-host.ps1'))

            const localPolicy: GalleryDlDiscoveryPolicy = {
                accepts: (url) => url === base + '/post/' + mode,

                identify: (_messages, files) =>
                    files.length === 2 &&
                    files.every((file) => file.metadata.category === 'sbfixture')
                        ? files.map((file): DownloadTargetInput => ({
                              targetKey: 'sbfixture:1:' + file.metadata.num,
                              sourceUrl: base + '/post/' + mode,
                              metadata: {
                                  kind: 'image',
                                  title: 'fixture',
                                  platformName: 'sbfixture'
                              }
                          }))
                        : undefined
            }

            adapter = new GalleryDlAdapter(
                {
                    async run(request) {
                        if (!request.arguments.includes('-J')) {
                            return runTrackedEngine(engine, request)
                        }

                        const args = [...request.arguments]

                        // 테스트 전용 추출기는 조회 단계에만 사용한다.
                        args.splice(
                            args.indexOf('--'),
                            0,
                            '-o',
                            'extractor.module-sources=' + JSON.stringify([modules])
                        )

                        const result = await runTrackedEngine(engine, {
                            ...request,
                            arguments: args
                        })

                        if (mode === 'error') {
                            const rows = JSON.parse(result.stdout) as unknown[][]

                            assert.ok(
                                rows.some(
                                    (row) =>
                                        row[0] === -1 &&
                                        (row[1] as { error?: string }).error === 'ValueError'
                                )
                            )
                        }

                        return result
                    }
                },
                root,
                resolve('bin/gallery-dl.exe'),
                localPolicy
            )

            return {
                engine,
                url: base + '/post/' + mode
            }
        }

        async function frozen(url: string) {
            const targets = await adapter.discover({
                ...context(),
                originalUrl: url
            })

            assert.equal(requests.filter((value) => /GET \/[ab]\.png/.test(value)).length, 0)

            return targets.map((row, position) => ({
                ...row,
                id: 'target-' + position,
                position
            }))
        }

        it('페이지가 바뀌어도 두 고정 파일과 헤더만 사용하고 해시가 일치한다', async () => {
            const { url } = await prepare()
            const targets = await frozen(url)

            const before = requests.filter((value) => value === 'GET /post/ok').length

            changed = true

            const results = await adapter.downloadFrozen({
                ...context(),
                targets
            })

            assert.equal(results.length, 2)

            const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')

            for (const result of results) {
                assert.equal(hash(await readFile(result.stagedPath)), hash(png))
            }

            assert.equal(requests.filter((value) => value === 'GET /post/ok').length, before)

            assert.ok(!requests.includes('GET /changed.png'))
        }, 60_000)

        it('두 번째 파일 실패 시 일부 파일을 완료로 반환하거나 원 페이지를 재조회하지 않는다', async () => {
            const { url } = await prepare()
            const targets = await frozen(url)

            const before = requests.filter((value) => value === 'GET /post/ok').length

            broken = true

            await assert.rejects(
                adapter.downloadFrozen({
                    ...context(),
                    targets
                }),
                error('DOWNLOAD_ENGINE_FAILED')
            )

            assert.equal(requests.filter((value) => value === 'GET /post/ok').length, before)

            assert.equal((await readdir(stage)).length, 1)
        }, 60_000)

        it('실제 엔진이 종료 코드 0으로 반환한 추출 예외를 감지한다', async () => {
            const { url } = await prepare('error')

            await assert.rejects(
                adapter.discover({
                    ...context(),
                    originalUrl: url
                }),
                error('TARGET_INCOMPLETE')
            )

            assert.deepEqual(await readdir(stage), [])
        }, 60_000)
    }
)
