import { sql } from 'drizzle-orm'
import { dirname } from 'node:path'
import type { V2Database } from '../repositories/MediaRepository'
import { DownloadRootRepository } from '../repositories/DownloadRootRepository'
import {
    DownloadRepository,
    DownloadRepositoryError,
    parseDownloadJobOptions,
    type DownloadJobOptions
} from '../repositories/DownloadRepository'
import { StorageDirectories, nodeStorageFileSystem } from './DownloadStorageService'
import { EngineProcess } from './EngineProcess'
import { YtdlpAdapter, YTDLP_VERSION, type YtdlpDiscoveryPolicy } from './YtdlpAdapter'
import { createDownloadRuntime } from './DownloadRuntime'

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/

function videoId(value: string): string | undefined {
    try {
        if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) {
            return
        }

        const url = new URL(value)

        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
            return
        }

        const tracking = new Set(['si', 'feature', 'ab_channel'])
        let id: string | undefined

        if (url.hostname === 'youtu.be') {
            id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
        } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
            if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
                id = url.searchParams.get('v')!
                tracking.add('v')
            } else {
                id = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
            }
        }

        if (!id || !videoIdPattern.test(id)) return

        for (const key of url.searchParams.keys()) {
            if (!tracking.has(key)) return
        }

        return id
    } catch {
        return
    }
}

export function createYouTubePolicy(originalUrl: string): YtdlpDiscoveryPolicy | undefined {
    const expectedId = videoId(originalUrl)

    if (!expectedId) return

    return {
        accepts: (url, options) =>
            videoId(url) === expectedId &&
            options.playlist !== true &&
            (options.type === undefined || options.type === 'video' || options.type === 'audio'),

        identify: (document, leaves) => {
            if (leaves.length !== 1) return

            for (const row of [document, leaves[0]]) {
                if (
                    (row._type !== undefined && row._type !== 'video') ||
                    row.entries !== undefined ||
                    row.id !== expectedId ||
                    row.extractor_key !== 'Youtube' ||
                    row.extractor !== 'youtube' ||
                    row.availability !== 'public' ||
                    row.age_limit !== 0 ||
                    row.live_status !== 'not_live' ||
                    row.is_live === true ||
                    row.is_upcoming === true ||
                    row.has_drm === true ||
                    typeof row.webpage_url !== 'string' ||
                    videoId(row.webpage_url) !== expectedId
                ) {
                    return
                }
            }

            return ['youtube:' + expectedId]
        }
    }
}

export interface YouTubeDownloadOptions {
    getStorageRoot: () => string
    getBinaries: () => { ytDlp: string; ffmpeg: string }
    hostScript: string
    nodeExecutable: string
    workingDirectory: string
    engine?: Pick<EngineProcess, 'run'>
}

export function createYouTubeDownloadRuntime(db: V2Database, options: YouTubeDownloadOptions) {
    const engine =
        options.engine ??
        new EngineProcess(options.hostScript, {
            electronAsNode: true
        })

    const jobs = new DownloadRepository(db)

    // 이전 프로세스의 종료를 확인하지 못한 작업은 자동 실행하지 않는다.
    const startupBlocked =
        db.get<{ blocked: number }>(sql`
        SELECT (
            EXISTS (
                SELECT 1
                FROM download_queue
                WHERE state = 'running'
            )
            OR EXISTS (
                SELECT 1
                FROM download_attempt
                WHERE outcome IS NULL
            )
        ) AS blocked
    `)?.blocked !== 0

    function checkStartup(): void {
        if (startupBlocked) {
            throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
        }
    }

    function accepts(url: string, jobOptions: Readonly<DownloadJobOptions>): boolean {
        return createYouTubePolicy(url)?.accepts(url, jobOptions) === true
    }

    async function version(executable: string, args: string[]) {
        const result = await engine.run({
            executable,
            arguments: args,
            cwd: options.workingDirectory,
            timeoutMs: 30_000,
            maxStdoutBytes: 64 * 1024,
            maxStderrBytes: 64 * 1024
        })

        return result.stdout.trim()
    }

    return createDownloadRuntime(db, {
        getStorageRoot: options.getStorageRoot,

        acceptsRequest: (url, jobOptions) => {
            checkStartup()

            return accepts(url, jobOptions)
        },

        beforeRun: async (jobId) => {
            checkStartup()

            const job = jobs.get(jobId)

            if (!job) {
                throw new DownloadRepositoryError('NOT_FOUND')
            }

            const jobOptions = parseDownloadJobOptions(job.optionsJson)

            if (!accepts(job.originalUrl, jobOptions)) {
                throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const binaries = options.getBinaries()

            const ytDlpVersion = await version(binaries.ytDlp, ['--ignore-config', '--version'])

            if (ytDlpVersion !== YTDLP_VERSION) {
                throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const nodeVersion = await version(options.nodeExecutable, ['--version'])

            const major = /^v(\d+)\.\d+\.\d+$/.exec(nodeVersion)?.[1]

            if (!major || Number(major) < 22) {
                throw new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED')
            }

            const ffmpegVersion = await version(binaries.ffmpeg, ['-version'])

            if (!ffmpegVersion.startsWith('ffmpeg version ')) {
                throw new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED')
            }

            const root = new DownloadRootRepository(db).get(jobId)

            try {
                await new StorageDirectories(dirname(root), nodeStorageFileSystem).check(root, true)
            } catch (error) {
                if (error instanceof DownloadRepositoryError) {
                    throw error
                }

                throw new DownloadRepositoryError('FILE_IO_ERROR')
            }
        },

        selectAdapter: (root, url) => {
            const policy = createYouTubePolicy(url)

            if (!policy) return

            const binaries = options.getBinaries()

            return new YtdlpAdapter(
                engine,
                root,
                binaries.ytDlp,
                binaries.ffmpeg,
                policy,
                options.nodeExecutable
            )
        }
    })
}
