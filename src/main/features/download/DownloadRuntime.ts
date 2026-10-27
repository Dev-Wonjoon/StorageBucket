import { sql } from 'drizzle-orm'
import type { V2Database } from '../media/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError,
    parseDownloadJobOptions,
    type DownloadJobOptions
} from './DownloadRepository'
import { DownloadRootRepository } from './DownloadRootRepository'
import { DownloadCommitRepository } from './DownloadCommitRepository'
import { DownloadRecoveryRepository } from './DownloadRecoveryRepository'
import { DownloadWorkspaceRepository } from './DownloadWorkspaceRepository'
import { DownloadCleanupRepository } from './DownloadCleanupRepository'
import type { DownloadAdapterSelector } from './DownloadAdapter'
import { DownloadWorkspaceService } from './DownloadWorkspaceService'
import { DownloadVerificationService } from './DownloadVerificationService'
import {
    DownloadStorageService,
    StorageDirectories,
    nodeStorageFileSystem
} from './DownloadStorageService'
import { DownloadCleanupService } from './DownloadCleanupService'
import { DownloadRunner } from './DownloadRunner'
import { DownloadService } from './DownloadService'
import { dirname } from 'node:path'
import { EngineProcess } from './EngineProcess'
import { YtdlpAdapter, YTDLP_VERSION } from './YtdlpAdapter'
import {
    GalleryDlAdapter,
    GALLERYDL_VERSION,
    type GalleryDlAuthentication
} from './GalleryDlAdapter'
import { createYouTubePolicy } from './YouTubePolicy'
import { createMappedGalleryDlPolicy } from './GalleryDlPolicy'

export interface DownloadRuntimePorts {
    acceptsRequest?: (...args: Parameters<DownloadAdapterSelector>) => boolean

    beforeRun?: (jobId: string) => Promise<void>

    selectAdapter: (
        storageRoot: string,
        ...args: Parameters<DownloadAdapterSelector>
    ) => ReturnType<DownloadAdapterSelector>
}

export interface DownloadEngineOptions {
    getBinaries: () => {
        ytDlp: string
        ffmpeg: string
        galleryDl?: string
    }
    getGalleryDlAuthentication?: () => Readonly<GalleryDlAuthentication>
    hostScript: string
    nodeExecutable: string
    workingDirectory: string
    engine?: Pick<EngineProcess, 'run'>
}

export type DownloadRuntimeOptions = {
    getStorageRoot: () => string
} & (
    | {
          engines: DownloadEngineOptions
          acceptsRequest?: never
          beforeRun?: never
          selectAdapter?: never
      }
    | (DownloadRuntimePorts & {
          engines?: never
      })
)

export interface DownloadRuntime {
    readonly service: DownloadService

    readonly recovery: Pick<DownloadRecoveryRepository, 'inspect' | 'recoverAtStartup'>

    readonly cleanup: Pick<DownloadCleanupService, 'runAtStartup'>
}

function createEnginePorts(
    db: V2Database,
    roots: DownloadRootRepository,
    config: DownloadEngineOptions
): DownloadRuntimePorts {
    const engine =
        config.engine ??
        new EngineProcess(config.hostScript, {
            electronAsNode: true
        })

    const jobs = new DownloadRepository(db)

    // 이전 프로세스의 종료를 확인하지 못했다면 실행을 차단한다.
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

    function selectPolicy(url: string, options: Readonly<DownloadJobOptions>) {
        const youtube = createYouTubePolicy(url)

        if (youtube?.accepts(url, options)) {
            return {
                kind: 'yt-dlp' as const,
                policy: youtube
            }
        }

        const gallery = createMappedGalleryDlPolicy(url)

        if (gallery?.accepts(url, options) && config.getBinaries().galleryDl) {
            return {
                kind: 'gallery-dl' as const,
                policy: gallery
            }
        }

        return undefined
    }

    async function version(executable: string, args: string[]): Promise<string> {
        const result = await engine.run({
            executable,
            arguments: args,
            cwd: config.workingDirectory,
            timeoutMs: 30_000,
            maxStdoutBytes: 64 * 1024,
            maxStderrBytes: 64 * 1024
        })

        return result.stdout.trim()
    }

    return {
        acceptsRequest: (url, options) => {
            checkStartup()

            return selectPolicy(url, options) !== undefined
        },

        beforeRun: async (jobId) => {
            checkStartup()

            const job = jobs.get(jobId)

            if (!job) {
                throw new DownloadRepositoryError('NOT_FOUND')
            }

            const options = parseDownloadJobOptions(job.optionsJson)

            const route = selectPolicy(job.originalUrl, options)

            if (!route) {
                throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY')
            }

            const binaries = config.getBinaries()

            if (route.kind === 'yt-dlp') {
                const installed = await version(binaries.ytDlp, ['--ignore-config', '--version'])

                if (installed !== YTDLP_VERSION) {
                    throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY')
                }

                const nodeVersion = await version(config.nodeExecutable, ['--version'])

                const major = /^v(\d+)\.\d+\.\d+$/.exec(nodeVersion)?.[1]

                if (!major || Number(major) < 22) {
                    throw new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED')
                }

                const ffmpegVersion = await version(binaries.ffmpeg, ['-version'])

                if (!ffmpegVersion.startsWith('ffmpeg version ')) {
                    throw new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED')
                }
            } else {
                if (!binaries.galleryDl) {
                    throw new DownloadRepositoryError('DOWNLOAD_ENGINE_FAILED')
                }

                const installed = await version(binaries.galleryDl, [
                    '--config-ignore',
                    '--version'
                ])

                if (installed !== GALLERYDL_VERSION) {
                    throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY')
                }
            }

            // 설정 변경과 무관하게 작업에 고정한 저장 경로를 사용한다.
            const root = roots.get(jobId)

            try {
                await new StorageDirectories(dirname(root), nodeStorageFileSystem).check(root, true)
            } catch (error) {
                if (error instanceof DownloadRepositoryError) {
                    throw error
                }

                throw new DownloadRepositoryError('FILE_IO_ERROR')
            }
        },

        selectAdapter: (root, url, options) => {
            const route = selectPolicy(url, options)

            if (!route) return

            const binaries = config.getBinaries()

            if (route.kind === 'yt-dlp') {
                return new YtdlpAdapter(
                    engine,
                    root,
                    binaries.ytDlp,
                    binaries.ffmpeg,
                    route.policy,
                    config.nodeExecutable
                )
            }

            if (!binaries.galleryDl) return

            return new GalleryDlAdapter(
                engine,
                root,
                binaries.galleryDl,
                route.policy,
                config.getGalleryDlAuthentication?.() ?? {}
            )
        }
    }
}

// 복구·정리는 프로세스·다운로드·미디어 편집이 멈춘 시작 단계에서만 호출한다.
export function createDownloadRuntime(
    db: V2Database,
    options: DownloadRuntimeOptions
): DownloadRuntime {
    const roots = new DownloadRootRepository(db)

    const ports: DownloadRuntimePorts =
        options.engines !== undefined ? createEnginePorts(db, roots, options.engines) : options

    function forRoot(storageRoot: string) {
        const jobs = new DownloadRepository(db)
        const commits = new DownloadCommitRepository(db, storageRoot)
        const recovery = new DownloadRecoveryRepository(db, storageRoot)

        const workspace = new DownloadWorkspaceService(
            new DownloadWorkspaceRepository(db),
            storageRoot
        )

        const verification = new DownloadVerificationService(jobs, storageRoot)

        const storage = new DownloadStorageService(commits, storageRoot)

        const cleanup = new DownloadCleanupService(
            new DownloadCleanupRepository(db, storageRoot),
            storageRoot
        )

        const runner = new DownloadRunner(
            {
                repository: jobs,
                commits,
                recovery,
                workspace,
                verification,
                storage,
                selectAdapter: (url, jobOptions) =>
                    ports.selectAdapter(storageRoot, url, jobOptions)
            },
            storageRoot
        )

        return { runner, recovery, cleanup }
    }

    const service = new DownloadService(
        db,
        {
            run: async (jobId, trigger) => {
                const root = roots.get(jobId)

                await ports.beforeRun?.(jobId)

                return forRoot(root).runner.run(jobId, trigger)
            },

            cancel: (jobId) => forRoot(roots.get(jobId)).runner.cancel(jobId)
        },
        options.getStorageRoot,
        ports.acceptsRequest
    )

    return {
        service,

        recovery: {
            inspect: (jobId) => forRoot(roots.get(jobId)).recovery.inspect(jobId),

            recoverAtStartup: (jobId) => forRoot(roots.get(jobId)).recovery.recoverAtStartup(jobId)
        },

        cleanup: {
            runAtStartup: (taskId) => {
                if (typeof taskId !== 'string' || !taskId.trim() || taskId.includes('\0')) {
                    throw new DownloadRepositoryError('INVALID_ARGUMENT')
                }

                const row = db.get<{ jobId: string }>(sql`
                    SELECT a.job_id AS jobId
                    FROM maintenance_task t
                    JOIN download_attempt a
                        ON a.id = t.download_attempt_id
                    WHERE t.id = ${taskId}
                      AND t.owner_kind = 'download'
                      AND t.kind = 'rollback_cleanup'
                `)

                if (!row) {
                    throw new DownloadRepositoryError('NOT_FOUND')
                }

                return forRoot(roots.get(row.jobId)).cleanup.runAtStartup(taskId)
            }
        }
    }
}
