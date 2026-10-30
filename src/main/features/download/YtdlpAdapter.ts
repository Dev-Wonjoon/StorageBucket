import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import {
    DownloadRepositoryError,
    parseDownloadJobOptions,
    type DownloadJobOptions,
    type DownloadTargetInput,
    type DownloadResultInput
} from './DownloadRepository'
import type { FrozenDownloadAdapter } from './DownloadAdapter'
import type { EngineProcess } from './EngineProcess'
import { downloadStagingDirectory } from './DownloadVerificationService'
import { StorageDirectories, nodeStorageFileSystem } from './DownloadStorageService'

type JsonObject = Record<string, unknown>
type Discovery = Parameters<FrozenDownloadAdapter['discover']>[0]
type Execution = Parameters<FrozenDownloadAdapter['downloadFrozen']>[0]

export interface YtdlpDiscoveryPolicy {
    // 요청 종류·전체 목록·영구 키를 검증한 정책만 주입한다.
    accepts(url: string, options: Readonly<DownloadJobOptions>): boolean

    identify(
        document: Readonly<JsonObject>,
        leaves: readonly Readonly<JsonObject>[]
    ): readonly string[] | undefined
}

type Entry = {
    target: DownloadTargetInput
    info: JsonObject
}

type Session = {
    jobId: string
    attemptId: string
    stagingDirectory: string
    options: string
    entries: Entry[]
    directories: StorageDirectories
}

export const YTDLP_VERSION = '2026.10.26'
const LIMIT = 16 * 1024 * 1024

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

function abort(signal: AbortSignal) {
    if (signal.aborted) fail('CANCEL_REQUESTED')
}

function options(value: Readonly<DownloadJobOptions>) {
    const parsed = parseDownloadJobOptions(JSON.stringify(value))

    return {
        type: parsed.type ?? 'video',
        quality: parsed.quality ?? 'best',
        playlist: parsed.playlist ?? false,
        extension:
            parsed.extension ??
            (parsed.type === 'audio' || parsed.quality === 'audio' ? 'mp3' : 'mp4')
    }
}

function flatten(value: unknown, out: JsonObject[] = [], depth = 0): JsonObject[] {
    if (depth > 16 || out.length >= 5000) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    const row = object(value)

    if (row._type === 'playlist' || row._type === 'multi_video') {
        if (!Array.isArray(row.entries) || !row.entries.length) {
            fail('TARGET_DISCOVERY_EMPTY')
        }

        for (const field of ['playlist_count', 'n_entries']) {
            const count = row[field]

            if (
                count !== undefined &&
                count !== null &&
                (!Number.isSafeInteger(count) || count !== row.entries.length)
            ) {
                fail('TARGET_INCOMPLETE')
            }
        }

        for (const entry of row.entries) {
            flatten(entry, out, depth + 1)
        }
    } else {
        if (
            (row._type !== undefined && row._type !== 'video') ||
            row.entries !== undefined ||
            row.is_live === true ||
            row.is_upcoming === true ||
            row.has_drm === true ||
            (row.live_status !== undefined &&
                row.live_status !== null &&
                !['not_live', 'was_live'].includes(String(row.live_status)))
        ) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }

        text(row.id)
        text(row.extractor_key)

        // 제목이 없어도 식별 가능한 미디어는 처리한다.
        if (row.title === undefined || row.title === null || row.title === '') {
            row.title = text(row.id)
        } else {
            text(row.title)
        }

        out.push(row)
    }

    return out
}

function copyFields(row: JsonObject, names: string[]): JsonObject {
    return Object.fromEntries(
        names.filter((name) => row[name] !== undefined).map((name) => [name, row[name]])
    )
}

function format(value: unknown): JsonObject {
    const row = object(value)
    const url = http(row.url)
    const protocol = row.protocol ?? new URL(url).protocol.slice(0, -1)

    if (
        !['http', 'https', 'm3u8', 'm3u8_native', 'http_dash_segments'].includes(
            String(protocol)
        ) ||
        row.has_drm === true
    ) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    const out = copyFields(row, [
        'format_id',
        'ext',
        'vcodec',
        'acodec',
        'width',
        'height',
        'fps',
        'tbr',
        'abr',
        'vbr',
        'asr',
        'audio_channels',
        'filesize',
        'filesize_approx',
        'language',
        'format_note',
        'quality',
        'preference',
        'source_preference',
        'language_preference',
        'dynamic_range',
        'container',
        'http_headers',
        'manifest_url',
        'fragment_base_url',
        'extra_param_to_segment_url'
    ])

    out.url = url
    out.protocol = protocol

    if (out.ext !== undefined && !/^[a-zA-Z0-9]{1,10}$/.test(text(out.ext))) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    for (const field of ['manifest_url', 'fragment_base_url']) {
        if (out[field] !== undefined && out[field] !== null) {
            http(out[field])
        }
    }

    if (row.fragments !== undefined) {
        if (!Array.isArray(row.fragments) || !row.fragments.length) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }

        out.fragments = row.fragments.map((value) => {
            const item = object(value)

            http(item.url)

            return copyFields(item, ['url', 'duration', 'range', 'index'])
        })
    }

    return out
}

function frozenInfo(row: JsonObject): JsonObject {
    const out = copyFields(row, [
        'id',
        'title',
        'extractor',
        'extractor_key',
        'duration',
        'uploader',
        'uploader_id',
        'channel',
        'channel_id',
        'http_headers'
    ])

    out._type = 'video'

    // webpage_url와 additional_urls, 내부 파일 경로·실행 상태를
    // 다운로드 엔진에 전달하지 않는다.
    const source = Array.isArray(row.formats) && row.formats.length ? row.formats : [row]

    const playable = source.filter((value) => {
        const item = object(value)

        return !(
            row.extractor_key === 'Youtube' &&
            item.protocol === 'mhtml' &&
            item.ext === 'mhtml' &&
            item.vcodec === 'none' &&
            item.acodec === 'none'
        )
    })

    if (!playable.length) {
        fail('UNSUPPORTED_TARGET_DISCOVERY')
    }

    out.formats = playable.map(format)

    return out
}

function metadata(row: JsonObject, audio: boolean): DownloadTargetInput['metadata'] {
    const result: DownloadTargetInput['metadata'] = {
        kind: audio || row.vcodec === 'none' ? 'audio' : 'video',
        externalId: text(row.id),
        platformName: text(row.extractor_key)
    }

    for (const [source, destination] of [
        ['title', 'title'],
        ['uploader_id', 'ownerId'],
        ['uploader', 'ownerName']
    ] as const) {
        const value = row[source]

        if (value !== undefined && value !== null && value !== '') {
            result[destination] = text(value)
        }
    }

    if (row.duration !== undefined && row.duration !== null) {
        if (
            typeof row.duration !== 'number' ||
            !Number.isFinite(row.duration) ||
            row.duration < 0
        ) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }

        result.duration = row.duration
    }

    return result
}

export class YtdlpAdapter implements FrozenDownloadAdapter {
    private readonly root: string
    private busy = false
    private poisoned = false
    private session?: Session

    constructor(
        private engine: Pick<EngineProcess, 'run'>,
        storageRoot: string,
        private executable: string,
        private ffmpeg: string,
        private policy: YtdlpDiscoveryPolicy,
        private nodeRuntime?: string
    ) {
        const paths = [
            storageRoot,
            executable,
            ffmpeg,
            ...(nodeRuntime === undefined ? [] : [nodeRuntime])
        ]

        for (const path of paths) {
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

    private async version(cwd: string, signal: AbortSignal) {
        const value = await this.engine.run({
            executable: this.executable,
            arguments: ['--ignore-config', '--version'],
            cwd,
            signal,
            timeoutMs: 30_000,
            maxStdoutBytes: 1024
        })

        if (value.stdout.trim() !== YTDLP_VERSION) {
            fail('UNSUPPORTED_TARGET_DISCOVERY')
        }
    }

    private args(value: ReturnType<typeof options>) {
        const audio = value.type === 'audio' || value.quality === 'audio'

        if ((audio && value.extension !== 'mp3') || (!audio && value.extension === 'mp3')) {
            fail('INVALID_ARGUMENT')
        }

        const heights: Record<string, number> = {
            '8k': 4320,
            '4k': 2160,
            '2k': 1440,
            '1080': 1080,
            '720': 720,
            '480': 480
        }

        const height = heights[value.quality]
        const filter = height ? '[height<=' + height + ']' : ''

        return [
            '--ignore-config',
            '--no-plugin-dirs',
            '--no-cache-dir',
            '--no-cookies',
            '--no-cookies-from-browser',
            '--no-js-runtimes',
            '--no-js-runtimes',
            ...(this.nodeRuntime ? ['--js-runtimes', 'node:' + this.nodeRuntime] : []),
            '--no-remote-components',
            '--encoding',
            'utf-8',
            '--no-colors',
            '--no-progress',
            '--quiet',
            '--abort-on-error',
            '--no-ignore-errors',
            '--no-warnings',
            '--no-write-thumbnail',
            '--no-write-info-json',
            '--no-write-description',
            '--no-write-subs',
            '--no-write-auto-subs',
            '--no-write-comments',
            '--no-write-playlist-metafiles',
            '--no-embed-info-json',
            '--no-continue',
            '--no-overwrites',
            '--no-part',
            '--no-simulate',
            '--ffmpeg-location',
            this.ffmpeg,
            '--format',
            audio ? 'bestaudio/best' : 'bestvideo' + filter + '+bestaudio/best' + filter,
            value.playlist ? '--yes-playlist' : '--no-playlist',
            ...(audio
                ? ['--extract-audio', '--audio-format', 'mp3']
                : ['--merge-output-format', value.extension, '--remux-video', value.extension])
        ]
    }

    private stage(input: Discovery | Execution) {
        const expected = downloadStagingDirectory(this.root, input.jobId, input.attemptId)

        if (input.stagingDirectory !== expected) {
            fail('UNSAFE_STAGING_PATH')
        }

        return expected
    }

    async discover(input: Discovery): Promise<readonly DownloadTargetInput[]> {
        return this.locked(async () => {
            this.session = undefined
            abort(input.signal)

            const stage = this.stage(input)
            const value = options(input.options)
            const args = this.args(value)
            const originalUrl = http(input.originalUrl)

            if (!this.policy.accepts(originalUrl, Object.freeze({ ...value }))) {
                fail('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const directories = new StorageDirectories(this.root, nodeStorageFileSystem)

            await this.io(() => directories.check(stage))

            if ((await this.io(() => readdir(stage))).length) {
                fail('UNSAFE_STAGING_PATH')
            }

            await this.version(stage, input.signal)

            const output = await this.engine.run({
                executable: this.executable,
                cwd: stage,
                signal: input.signal,
                arguments: [
                    ...args,
                    '--dump-single-json',
                    '--skip-download',
                    '--no-flat-playlist',
                    '--no-lazy-playlist',
                    '--',
                    originalUrl
                ],
                timeoutMs: 120_000,
                maxStdoutBytes: LIMIT
            })

            abort(input.signal)

            let document: JsonObject

            try {
                document = object(JSON.parse(output.stdout))
            } catch {
                fail('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const leaves = flatten(document)

            const keys = this.policy.identify(structuredClone(document), structuredClone(leaves))

            if (!keys || keys.length !== leaves.length) {
                fail('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const seen = new Set<string>()

            const entries = leaves.map((row, index): Entry => {
                const targetKey = text(keys[index])

                if (seen.has(targetKey)) fail('TARGET_DUPLICATE')
                seen.add(targetKey)

                return {
                    target: {
                        targetKey,
                        sourceUrl: http(row.webpage_url ?? originalUrl),
                        metadata: metadata(row, value.type === 'audio' || value.quality === 'audio')
                    },
                    info: frozenInfo(row)
                }
            })

            await this.io(() => directories.check(stage))

            if ((await this.io(() => readdir(stage))).length) {
                fail('UNSAFE_STAGING_PATH')
            }

            this.session = {
                jobId: input.jobId,
                attemptId: input.attemptId,
                stagingDirectory: stage,
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
                session.stagingDirectory !== stage ||
                session.options !== JSON.stringify(value) ||
                input.targets.length !== session.entries.length
            ) {
                fail('VERIFICATION_CHANGED')
            }

            const ids = new Set<string>()

            for (let index = 0; index < input.targets.length; index++) {
                const actual = input.targets[index]
                const expected = session.entries[index].target

                if (
                    !actual.id ||
                    ids.has(actual.id) ||
                    actual.position !== index ||
                    actual.targetKey !== expected.targetKey ||
                    actual.sourceUrl !== expected.sourceUrl ||
                    JSON.stringify(Object.entries(actual.metadata).sort()) !==
                        JSON.stringify(Object.entries(expected.metadata).sort())
                ) {
                    fail('VERIFICATION_CHANGED')
                }

                ids.add(actual.id)
            }

            const args = this.args(value)

            await this.io(() => session.directories.check(stage))

            if ((await this.io(() => readdir(stage))).length) {
                fail('UNSAFE_STAGING_PATH')
            }

            await this.version(stage, input.signal)

            const results: DownloadResultInput[] = []

            for (const entry of session.entries) {
                abort(input.signal)

                await this.io(() => session.directories.check(stage))

                const prefix = createHash('sha256').update(entry.target.targetKey).digest('hex')

                const output = await this.engine.run({
                    executable: this.executable,
                    cwd: stage,
                    signal: input.signal,
                    arguments: [
                        ...args,
                        '--paths',
                        'home:' + stage,
                        '--paths',
                        'temp:' + stage,
                        '--output',
                        prefix + '.%(ext)s',
                        '--print',
                        'after_move:%(filepath)j',
                        '--load-info-json',
                        '-'
                    ],
                    input: JSON.stringify(entry.info),
                    timeoutMs: 1_800_000,
                    maxStdoutBytes: 64 * 1024
                })

                abort(input.signal)

                let path: unknown

                try {
                    path = JSON.parse(output.stdout.trim())
                } catch {
                    fail('TARGET_INCOMPLETE')
                }

                if (
                    typeof path !== 'string' ||
                    !isAbsolute(path) ||
                    path.includes('\0') ||
                    dirname(path) !== stage ||
                    basename(path) !== prefix + '.' + value.extension
                ) {
                    fail('UNSAFE_STAGING_PATH')
                }

                await this.io(() => session.directories.check(stage))

                const info = await this.io(() => nodeStorageFileSystem.lstat(path as string))

                if (info.kind !== 'file' || info.nlink !== 1n || info.size <= 0n) {
                    fail('FILE_NOT_REGULAR')
                }

                results.push({
                    targetKey: entry.target.targetKey,
                    stagedPath: path
                })
            }

            const names = await this.io(() => readdir(stage))

            const expected = new Set(results.map((result) => basename(result.stagedPath)))

            if (names.length !== expected.size || names.some((name) => !expected.has(name))) {
                fail('TARGET_UNEXPECTED_RESULT')
            }

            await this.io(() => session.directories.check(stage))

            return results
        })
    }
}
