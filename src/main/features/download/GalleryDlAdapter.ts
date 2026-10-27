import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'
import {
    DownloadRepositoryError,
    parseDownloadJobOptions,
    type DownloadTargetInput,
    type DownloadResultInput,
    type DownloadJobOptions
} from './DownloadRepository'
import type { FrozenDownloadAdapter } from './DownloadAdapter'
import type { EngineProcess } from './EngineProcess'
import { downloadStagingDirectory } from './DownloadVerificationService'
import { StorageDirectories, nodeStorageFileSystem } from './DownloadStorageService'

type JsonObject = Record<string, unknown>
type Discovery = Parameters<FrozenDownloadAdapter['discover']>[0]
type Execution = Parameters<FrozenDownloadAdapter['downloadFrozen']>[0]

export const GALLERYDL_VERSION = '1.32.1'

export interface GalleryDlFile {
    readonly url: string
    readonly metadata: Readonly<JsonObject>
}

export interface GalleryDlDiscoveryPolicy {
    accepts(url: string, options: Readonly<DownloadJobOptions>): boolean

    // 전체 목록·영구 파일 키를 검증하고 files와 같은 순서로 반환한다.
    identify(
        messages: readonly unknown[],
        files: readonly GalleryDlFile[]
    ): readonly DownloadTargetInput[] | undefined
}

type Entry = {
    target: DownloadTargetInput
    file: GalleryDlFile
    extension: string
}

type Session = {
    jobId: string
    attemptId: string
    stage: string
    options: string
    entries: Entry[]
    directories: StorageDirectories
}

function fail(code: ConstructorParameters<typeof DownloadRepositoryError>[0]): never {
    throw new DownloadRepositoryError(code)
}

function object(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    return value as JsonObject
}

function text(value: unknown): string {
    if (typeof value !== 'string' || !value || value.includes('\0')) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    return value
}

function http(value: unknown): string {
    const result = text(value)

    try {
        const url = new URL(result)

        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw Error()
        }
    } catch {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    return result
}

function options(value: Readonly<DownloadJobOptions>) {
    const parsed = parseDownloadJobOptions(JSON.stringify(value))

    if (
        parsed.type === 'audio' ||
        (parsed.quality !== undefined && parsed.quality !== 'best') ||
        parsed.extension !== undefined
    ) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    return {
        type: parsed.type ?? 'video',
        quality: parsed.quality ?? 'best',
        playlist: parsed.playlist ?? false
    } as const
}

function parse(stdout: string): {
    messages: unknown[]
    files: GalleryDlFile[]
} {
    let messages: unknown

    try {
        messages = JSON.parse(stdout)
    } catch {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    if (!Array.isArray(messages) || messages.length > 20_000) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    const files: GalleryDlFile[] = []

    for (const message of messages) {
        if (!Array.isArray(message)) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }

        if (message[0] === -1) {
            fail('TARGET_INCOMPLETE')
        }

        if (message[0] === 2 && message.length === 2) {
            object(message[1])
        } else if (message[0] === 3 && message.length === 3) {
            files.push({
                url: http(message[1]),
                metadata: object(message[2])
            })
        } else {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }
    }

    if (!files.length) fail('TARGET_DISCOVERY_EMPTY')
    if (files.length > 5000) fail('UNSUPPORTED_TARGET_DISCOVERY')

    return { messages, files }
}

function extension(file: GalleryDlFile) {
    const ext = extname(new URL(file.url).pathname).slice(1).toLowerCase()

    if (
        ![
            'jpg',
            'jpeg',
            'jpe',
            'png',
            'gif',
            'bmp',
            'webp',
            'avif',
            'heic',
            'mp4',
            'm4v',
            'mov',
            'mkv',
            'webm',
            'ogm',
            'ogv',
            'wav',
            'mp3',
            'opus'
        ].includes(ext) ||
        (file.metadata.extension !== undefined && file.metadata.extension !== ext)
    ) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    // 후속 변환·대체 URL·비 HTTP 다운로드 상태를 재생하지 않는다.
    for (const key of ['_fallback', '_http_cookies', '_ytdl', '_ugoira']) {
        if (file.metadata[key]) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }
    }

    return ext
}

function headers(file: GalleryDlFile) {
    const value = file.metadata._http_headers

    if (value === undefined || value === null) {
        return {}
    }

    const out = object(value)

    if (
        JSON.stringify(out).length > 8192 ||
        Object.entries(out).some(
            ([name, value]) =>
                !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name) ||
                typeof value !== 'string' ||
                /[\r\n\0]/.test(value)
        )
    ) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    return out
}

function abort(signal: AbortSignal) {
    if (signal.aborted) fail('CANCEL_REQUESTED')
}

export class GalleryDlAdapter implements FrozenDownloadAdapter {
    private readonly root: string
    private busy = false
    private poisoned = false
    private session?: Session

    constructor(
        private engine: Pick<EngineProcess, 'run'>,
        storageRoot: string,
        private executable: string,
        private policy: GalleryDlDiscoveryPolicy
    ) {
        for (const path of [storageRoot, executable]) {
            if (!isAbsolute(path) || path.includes('\0')) {
                fail('INVALID_ARGUMENT')
            }
        }

        this.root = resolve(storageRoot)
    }

    private async locked<T>(action: () => Promise<T>): Promise<T> {
        if (this.poisoned) fail('ENGINE_STOP_UNCONFIRMED')
        if (this.busy) fail('ALREADY_PROCESSING')

        this.busy = true

        try {
            return await action()
        } catch (error) {
            this.session = undefined

            if (error instanceof DownloadRepositoryError) {
                if (error.code === 'ENGINE_STOP_UNCONFIRMED') {
                    this.poisoned = true
                }

                throw error
            }

            fail('DOWNLOAD_ENGINE_FAILED')
        } finally {
            this.busy = false
        }
    }

    private async io<T>(action: () => Promise<T>): Promise<T> {
        try {
            return await action()
        } catch (error) {
            if (error instanceof DownloadRepositoryError) {
                throw error
            }

            fail('FILE_IO_ERROR')
        }
    }

    private args() {
        const settings: Record<string, unknown> = {
            'extractor.module-sources': [null],
            'cache.file': null,
            cookies: null,
            'cookies-update': false,
            netrc: false,
            postprocessors: [],
            archive: null,
            retries: 0,
            skip: true,
            part: false,
            'user-agent': `StorageBucket/2.0 gallery-dl/${GALLERYDL_VERSION}`,
            'output.stdout': 'utf-8',
            'output.stderr': 'utf-8',
            'output.mode': 'null',
            'output.private': true
        }

        return [
            '--config-ignore',
            '--no-input',
            ...Object.entries(settings).flatMap(([key, value]) => [
                '-o',
                key + '=' + JSON.stringify(value)
            ])
        ]
    }

    private async version(cwd: string, signal: AbortSignal) {
        const result = await this.engine.run({
            executable: this.executable,
            arguments: ['--config-ignore', '--version'],
            cwd,
            signal,
            timeoutMs: 30_000,
            maxStdoutBytes: 1024
        })

        if (result.stdout.trim() !== GALLERYDL_VERSION) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }
    }

    private stage(input: Discovery | Execution) {
        const stage = downloadStagingDirectory(this.root, input.jobId, input.attemptId)

        if (input.stagingDirectory !== stage) {
            fail('UNSAFE_STAGING_PATH')
        }

        return stage
    }

    async discover(input: Discovery): Promise<readonly DownloadTargetInput[]> {
        return this.locked(async () => {
            this.session = undefined
            abort(input.signal)

            const stage = this.stage(input)
            const value = options(input.options)
            const url = http(input.originalUrl)

            if (!this.policy.accepts(url, Object.freeze({ ...value }))) {
                fail('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const directories = new StorageDirectories(this.root, nodeStorageFileSystem)

            await this.io(() => directories.check(stage))

            if ((await this.io(() => readdir(stage))).length) {
                fail('UNSAFE_STAGING_PATH')
            }

            await this.version(stage, input.signal)

            const result = await this.engine.run({
                executable: this.executable,
                arguments: [...this.args(), '-J', '--', url],
                cwd: stage,
                signal: input.signal,
                timeoutMs: 120_000,
                maxStdoutBytes: 16 * 1024 * 1024
            })

            abort(input.signal)

            const { messages, files } = parse(result.stdout)

            const targets = this.policy.identify(structuredClone(messages), structuredClone(files))

            if (!targets || targets.length !== files.length) {
                fail('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const keys = new Set<string>()

            const entries = files.map((file, index): Entry => {
                const target = structuredClone(targets[index])

                text(target.targetKey)
                http(target.sourceUrl)
                object(target.metadata)

                if (keys.has(target.targetKey)) {
                    fail('TARGET_DUPLICATE')
                }

                keys.add(target.targetKey)
                headers(file)

                return {
                    target,
                    file,
                    extension: extension(file)
                }
            })

            await this.io(() => directories.check(stage))

            if ((await this.io(() => readdir(stage))).length) {
                fail('UNSAFE_STAGING_PATH')
            }

            this.session = {
                jobId: input.jobId,
                attemptId: input.attemptId,
                stage,
                options: JSON.stringify(value),
                entries,
                directories
            }

            return structuredClone(entries.map((entry) => entry.target))
        })
    }

    async downloadFrozen(input: Execution): Promise<readonly DownloadResultInput[]> {
        return this.locked(async () => {
            const session = this.session
            this.session = undefined

            abort(input.signal)

            const stage = this.stage(input)
            const value = options(input.options)

            if (
                !session ||
                session.jobId !== input.jobId ||
                session.attemptId !== input.attemptId ||
                session.stage !== stage ||
                session.options !== JSON.stringify(value) ||
                input.targets.length !== session.entries.length
            ) {
                fail('VERIFICATION_CHANGED')
            }

            const ids = new Set<string>()

            for (let i = 0; i < input.targets.length; i++) {
                const actual = input.targets[i]
                const expected = session.entries[i].target

                if (
                    !actual.id ||
                    ids.has(actual.id) ||
                    actual.position !== i ||
                    actual.targetKey !== expected.targetKey ||
                    actual.sourceUrl !== expected.sourceUrl ||
                    JSON.stringify(Object.entries(actual.metadata).sort()) !==
                        JSON.stringify(Object.entries(expected.metadata).sort())
                ) {
                    fail('VERIFICATION_CHANGED')
                }

                ids.add(actual.id)
            }

            await this.io(() => session.directories.check(stage))

            if ((await this.io(() => readdir(stage))).length) {
                fail('UNSAFE_STAGING_PATH')
            }

            await this.version(stage, input.signal)

            const results: DownloadResultInput[] = []
            const names = new Set<string>()

            for (const entry of session.entries) {
                abort(input.signal)

                const name =
                    createHash('sha256').update(entry.target.targetKey).digest('hex') +
                    '.' +
                    entry.extension

                if (names.has(name)) {
                    fail('TARGET_PATH_COLLISION')
                }

                names.add(name)

                const path = join(stage, name)

                await this.io(() => session.directories.check(stage))

                await this.engine.run({
                    executable: this.executable,
                    cwd: stage,
                    signal: input.signal,
                    arguments: [
                        ...this.args(),
                        '-o',
                        'extractor.modules=["directlink"]',
                        '-o',
                        'keywords=' +
                            JSON.stringify({
                                _http_headers: headers(entry.file)
                            }),
                        '-D',
                        stage,
                        '-f',
                        name,
                        '--',
                        entry.file.url
                    ],
                    timeoutMs: 1_800_000,
                    maxStdoutBytes: 64 * 1024
                })

                abort(input.signal)

                await this.io(() => session.directories.check(stage))

                const info = await this.io(() => nodeStorageFileSystem.lstat(path))

                if (info.kind !== 'file' || info.nlink !== 1n) {
                    fail('FILE_NOT_REGULAR')
                }

                if (info.size <= 0n) {
                    fail('FILE_EMPTY')
                }

                results.push({
                    targetKey: entry.target.targetKey,
                    stagedPath: path
                })
            }

            const actual = await this.io(() => readdir(stage))

            if (actual.length !== names.size || actual.some((name) => !names.has(name))) {
                fail('TARGET_UNEXPECTED_RESULT')
            }

            await this.io(() => session.directories.check(stage))

            return results
        })
    }
}
