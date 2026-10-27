import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'vitest'
import { EngineProcess } from '../../../src/main/features/download/EngineProcess'
import { DownloadRepositoryError } from '@features/download/DownloadRepository'

let root: string
let host: string
let engine: EngineProcess

const owned = new Set<number>()
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

function error(code: string) {
    return (value: unknown) => value instanceof DownloadRepositoryError && value.code === code
}

function alive(pid: number) {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

async function waitPids() {
    for (let n = 0; n < 400; n++) {
        try {
            const pids = JSON.parse(await readFile(join(root, 'pids.json'), 'utf8')) as number[]

            assert.equal(pids.length, 3)

            for (const pid of pids) {
                assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid)
                owned.add(pid)
            }

            return pids
        } catch {
            await pause(10)
        }
    }

    throw Error('fixture did not start')
}

function tree() {
    const leaf = `
        require('node:fs').writeFileSync(
            ${JSON.stringify(join(root, 'pids.json'))},
            JSON.stringify([Number(process.argv[1]), process.ppid, process.pid])
        );
        setInterval(() => {}, 1000);
    `

    const middle = `
        require('node:child_process').spawn(
            process.execPath,
            ['-e', ${JSON.stringify(leaf)}, process.argv[1]],
            { stdio: 'ignore', windowsHide: true, detached: true }
        );
        setInterval(() => {}, 1000);
    `

    return `
        require('node:child_process').spawn(
            process.execPath,
            ['-e', ${JSON.stringify(middle)}, String(process.pid)],
            { stdio: 'ignore', windowsHide: true, detached: true }
        );
        setInterval(() => {}, 1000);
    `
}

function run(code: string, extra: Partial<Parameters<EngineProcess['run']>[0]> = {}) {
    return engine.run({
        executable: process.execPath,
        arguments: ['-e', code],
        cwd: root,
        timeoutMs: 20_000,
        stopGraceMs: 10_000,
        ...extra
    })
}

describe.skipIf(process.platform !== 'win32')('EngineProcess', () => {
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'storagebucket-engine-process-'))

        host = join(root, 'engine-host.ps1')

        await writeFile(host, await readFile(resolve('resources/engine-host.ps1'), 'utf8'), 'utf8')

        engine = new EngineProcess(host)
    })

    afterEach(async () => {
        for (const pid of owned) {
            if (alive(pid)) {
                try {
                    process.kill(pid)
                } catch {
                    // 이미 종료된 경우
                }
            }
        }

        owned.clear()

        assert.equal(dirname(resolve(root)), resolve(tmpdir()))
        assert.ok(basename(root).startsWith('storagebucket-engine-process-'))

        await rm(root, {
            recursive: true,
            force: true,
            maxRetries: 20,
            retryDelay: 50
        })
    })

    it('한글과 인수의 따옴표·역슬래시·빈 값을 그대로 전달한다', async () => {
        const args = ['', '한글 경로', 'a"b', 'tail\\', 'a\\"b']

        const result = await run('', {
            arguments: [
                '-e',
                'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
                ...args
            ]
        })

        assert.deepEqual(JSON.parse(result.stdout), args)
        assert.equal(result.stderr, '')
    }, 30_000)

    it('표준 입력과 표준 오류를 UTF-8로 전달한다', async () => {
        const result = await run(
            "process.stdin.pipe(process.stdout); process.stderr.write('오류 출력')",
            { input: '입력\n한글' }
        )

        assert.equal(result.stdout, '입력\n한글')
        assert.equal(result.stderr, '오류 출력')
    }, 30_000)

    it('0이 아닌 종료 코드는 원문 출력 없이 오류로 반환한다', async () => {
        await assert.rejects(
            run("process.stderr.write('secret');process.exit(3)"),
            (value) =>
                error('DOWNLOAD_ENGINE_FAILED')(value) && !JSON.stringify(value).includes('secret')
        )
    }, 30_000)

    it('실행 전에 취소됐다면 프로세스를 만들지 않는다', async () => {
        const controller = new AbortController()
        controller.abort()

        await assert.rejects(
            run('process.exit(0)', { signal: controller.signal }),
            error('CANCEL_REQUESTED')
        )
    })

    it('취소 시 엔진과 자식·손자의 종료를 확인한 뒤 반환한다', async () => {
        const controller = new AbortController()
        const running = run(tree(), { signal: controller.signal })
        const checked = assert.rejects(running, error('CANCEL_REQUESTED'))

        let pids: number[] = []

        try {
            pids = await waitPids()
            assert.ok(pids.every(alive))
        } finally {
            controller.abort()
            await checked
        }

        assert.ok(pids.every((pid) => !alive(pid)))
    }, 30_000)

    it('시간 초과 시 엔진과 자식·손자의 종료를 확인한 뒤 반환한다', async () => {
        const running = run(tree(), { timeoutMs: 6000 })
        const checked = assert.rejects(running, error('ENGINE_TIMEOUT'))

        let pids: number[] = []

        try {
            pids = await waitPids()
        } finally {
            await checked
        }

        assert.ok(pids.every((pid) => !alive(pid)))
    }, 30_000)

    it('루트가 먼저 종료돼도 남은 자식이 종료될 때까지 기다린다', async () => {
        const output = join(root, 'child-done')
        const child = `
            setTimeout(
                () => require('node:fs').writeFileSync(
                    ${JSON.stringify(output)}, 'done'
                ),
                350
            )
        `

        const result = await run(`
            require('node:child_process').spawn(
                process.execPath,
                ['-e', ${JSON.stringify(child)}],
                { stdio: 'ignore', windowsHide: true, detached: true }
            );
            process.exit(0);
        `)

        assert.equal(result.stdout, '')
        assert.equal(await readFile(output, 'utf8'), 'done')
    }, 30_000)

    it.each(['stdout', 'stderr'] as const)(
        '%s 상한 초과 시 종료 후 오류로 반환한다',
        async (stream) => {
            await assert.rejects(
                run(`process.${stream}.write('x'.repeat(20000));setInterval(()=>{},1000)`, {
                    maxStdoutBytes: 1024,
                    maxStderrBytes: 1024
                }),
                error('ENGINE_OUTPUT_LIMIT')
            )
        },
        30_000
    )

    it('잘못된 UTF-8 출력을 성공으로 반환하지 않는다', async () => {
        await assert.rejects(
            run('process.stdout.write(Buffer.from([0xff]))'),
            error('DOWNLOAD_ENGINE_FAILED')
        )
    }, 30_000)

    it('종료 확인 응답이 없으면 종료 미확인으로 보류한다', async () => {
        await writeFile(host, 'exit 0', 'utf8')

        await assert.rejects(run('process.exit(0)'), error('ENGINE_STOP_UNCONFIRMED'))
    }, 30_000)

    it('호스트가 응답하지 않으면 유예 시간 후 종료 미확인으로 보류한다', async () => {
        await writeFile(host, 'Start-Sleep -Seconds 30', 'utf8')

        await assert.rejects(
            run('process.exit(0)', {
                timeoutMs: 200,
                stopGraceMs: 200
            }),
            error('ENGINE_STOP_UNCONFIRMED')
        )
    }, 30_000)

    it('실행 파일이 없으면 실행 전 오류로 처리한다', async () => {
        await assert.rejects(
            run('', { executable: join(root, 'missing.exe') }),
            error('DOWNLOAD_ENGINE_FAILED')
        )
    })

    it('셸 파일과 NUL 인수를 허용하지 않는다', async () => {
        await assert.rejects(
            run('', { executable: join(root, 'engine.cmd') }),
            error('INVALID_ARGUMENT')
        )

        await assert.rejects(run('', { arguments: ['bad\0argument'] }), error('INVALID_ARGUMENT'))
    })
})
