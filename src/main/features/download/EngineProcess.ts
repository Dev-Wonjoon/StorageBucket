import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { TextDecoder } from 'node:util'
import { DownloadRepositoryError } from './DownloadRepository'

export interface EngineProcessRequest {
    executable: string
    arguments: readonly string[]
    cwd: string
    input?: string
    signal?: AbortSignal
    timeoutMs?: number
    stopGraceMs?: number
    maxStdoutBytes?: number
    maxStderrBytes?: number
}

export interface EngineProcessResult {
    stdout: string
    stderr: string
}

function positive(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }
}

function absolute(path: string) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }
}

export class EngineProcess {
    constructor(
        private hostScript: string,
        private readonly options: { electronAsNode?: boolean } = {}
    ) {
        absolute(hostScript)
    }

    async run(request: EngineProcessRequest): Promise<EngineProcessResult> {
        if (request.signal?.aborted) {
            throw new DownloadRepositoryError('CANCEL_REQUESTED')
        }

        if (process.platform !== 'win32') {
            throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY', {
                reason: 'WINDOWS_HOST_REQUIRED'
            })
        }

        absolute(request.executable)
        absolute(request.cwd)

        if (
            extname(request.executable).toLowerCase() !== '.exe' ||
            !Array.isArray(request.arguments) ||
            request.arguments.some((value) => typeof value !== 'string' || value.includes('\0')) ||
            (request.input !== undefined && typeof request.input !== 'string')
        ) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        const timeoutMs = request.timeoutMs ?? 120_000
        const stopGraceMs = request.stopGraceMs ?? 15_000
        const stdoutLimit = request.maxStdoutBytes ?? 16 * 1024 * 1024
        const stderrLimit = request.maxStderrBytes ?? 4 * 1024 * 1024

        for (const value of [timeoutMs, stopGraceMs, stdoutLimit, stderrLimit]) {
            positive(value)
        }

        const input = Buffer.from(request.input ?? '', 'utf8')

        if (input.length > 16 * 1024 * 1024) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        try {
            const [host, executable, cwd] = await Promise.all([
                stat(this.hostScript),
                stat(request.executable),
                stat(request.cwd)
            ])

            if (!host.isFile() || !executable.isFile() || !cwd.isDirectory()) {
                throw new Error()
            }
        } catch {
            throw new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED', {
                reason: 'START_PATH'
            })
        }

        if (request.signal?.aborted) {
            throw new DownloadRepositoryError('CANCEL_REQUESTED')
        }

        const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
        absolute(systemRoot)

        const powershell = join(
            systemRoot,
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        )

        const nonce = randomBytes(32).toString('hex')
        const marker = Buffer.from('SB_ENGINE_' + nonce + ':', 'ascii')

        return new Promise((resolve, reject) => {
            const child = spawn(
                powershell,
                [
                    '-NoLogo',
                    '-NoProfile',
                    '-NonInteractive',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    this.hostScript
                ],
                {
                    cwd: request.cwd,
                    env: this.options.electronAsNode
                        ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
                        : process.env,
                    windowsHide: true,
                    shell: false,
                    stdio: ['pipe', 'pipe', 'pipe']
                }
            )

            let settled = false
            let reason: 'CANCEL_REQUESTED' | 'ENGINE_TIMEOUT' | 'ENGINE_OUTPUT_LIMIT' | undefined

            let deadline: ReturnType<typeof setTimeout> | undefined
            let grace: ReturnType<typeof setTimeout> | undefined
            let stdoutSize = 0
            let stderrSize = 0
            let tail = Buffer.alloc(0)

            const stdout: Buffer[] = []
            const stderr: Buffer[] = []

            const finish = (error?: DownloadRepositoryError, result?: EngineProcessResult) => {
                if (settled) return
                settled = true

                if (deadline) clearTimeout(deadline)
                if (grace) clearTimeout(grace)

                request.signal?.removeEventListener('abort', abort)
                child.stdin.destroy()
                child.stdout.destroy()
                child.stderr.destroy()

                if (error) reject(error)
                else resolve(result!)
            }

            const unknown = () => {
                child.kill()
                child.unref()
                finish(new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED'))
            }

            const stop = (code: NonNullable<typeof reason>) => {
                if (settled || reason) return

                reason = code
                child.stdin.write('cancel\n')
                grace = setTimeout(unknown, stopGraceMs)
            }

            const abort = () => stop('CANCEL_REQUESTED')

            child.on('error', () => {
                if (!child.pid) {
                    finish(
                        new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED', {
                            reason: 'HOST_START'
                        })
                    )
                } else {
                    unknown()
                }
            })

            child.stdin.on('error', () => {
                if (!settled && !grace) {
                    grace = setTimeout(unknown, stopGraceMs)
                }
            })

            child.stdout.on('data', (data: Buffer) => {
                stdoutSize += data.length
                tail = Buffer.concat([tail, data]).subarray(-4096)

                if (stdoutSize <= stdoutLimit + 4096) {
                    stdout.push(data)
                } else {
                    stop('ENGINE_OUTPUT_LIMIT')
                }
            })

            child.stderr.on('data', (data: Buffer) => {
                stderrSize += data.length

                if (stderrSize <= stderrLimit) {
                    stderr.push(data)
                } else {
                    stop('ENGINE_OUTPUT_LIMIT')
                }
            })

            child.once('close', (hostExitCode) => {
                if (settled) return

                try {
                    const index = tail.lastIndexOf(marker)

                    if (hostExitCode !== 0 || index < 1 || tail[index - 1] !== 10) {
                        throw new Error()
                    }

                    const proof = JSON.parse(
                        tail
                            .subarray(index + marker.length)
                            .toString('utf8')
                            .trim()
                    )

                    if (
                        proof.quiescent !== true ||
                        !Number.isSafeInteger(proof.exitCode) ||
                        proof.exitCode < 0 ||
                        proof.exitCode > 0xffffffff ||
                        typeof proof.canceled !== 'boolean' ||
                        typeof proof.timedOut !== 'boolean' ||
                        typeof proof.inputFailed !== 'boolean'
                    ) {
                        throw new Error()
                    }

                    const separator = index >= 2 && tail[index - 2] === 13 ? 2 : 1

                    const length = stdoutSize - tail.length + index - separator

                    if (reason) {
                        finish(new DownloadRepositoryError(reason))
                    } else if (proof.timedOut) {
                        finish(new DownloadRepositoryError('ENGINE_TIMEOUT'))
                    } else if (proof.canceled) {
                        finish(new DownloadRepositoryError('CANCEL_REQUESTED'))
                    } else if (length > stdoutLimit || stderrSize > stderrLimit) {
                        finish(new DownloadRepositoryError('ENGINE_OUTPUT_LIMIT'))
                    } else if (proof.exitCode !== 0 || proof.inputFailed) {
                        finish(
                            new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED', {
                                reason: 'ENGINE_EXIT'
                            })
                        )
                    } else {
                        const decoder = new TextDecoder('utf-8', { fatal: true })

                        try {
                            finish(undefined, {
                                stdout: decoder.decode(Buffer.concat(stdout).subarray(0, length)),
                                stderr: decoder.decode(Buffer.concat(stderr))
                            })
                        } catch {
                            finish(
                                new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED', {
                                    reason: 'INVALID_UTF8'
                                })
                            )
                        }
                    }
                } catch {
                    finish(new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED'))
                }
            })

            request.signal?.addEventListener('abort', abort, { once: true })

            child.stdin.write(
                JSON.stringify({
                    nonce,
                    executable: request.executable,
                    arguments: request.arguments,
                    cwd: request.cwd,
                    input: input.toString('base64'),
                    timeoutMs
                }) + '\n'
            )

            deadline = setTimeout(() => stop('ENGINE_TIMEOUT'), timeoutMs)

            if (request.signal?.aborted) abort()
        })
    }
}
