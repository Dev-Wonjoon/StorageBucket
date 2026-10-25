import { sql } from 'drizzle-orm'
import type { V2Database } from '../repositories/MediaRepository'
import { DownloadRepository, DownloadRepositoryError } from '../repositories/DownloadRepository'
import { DownloadRootRepository } from '../repositories/DownloadRootRepository'
import { DownloadCommitRepository } from '../repositories/DownloadCommitRepository'
import { DownloadRecoveryRepository } from '../repositories/DownloadRecoveryRepository'
import { DownloadWorkspaceRepository } from '../repositories/DownloadWorkspaceRepository'
import { DownloadCleanupRepository } from '../repositories/DownloadCleanupRepository'
import type { DownloadAdapterSelector } from './DownloadAdapter'
import { DownloadWorkspaceService } from './DownloadWorkspaceService'
import { DownloadVerificationService } from './DownloadVerificationService'
import { DownloadStorageService } from './DownloadStorageService'
import { DownloadCleanupService } from './DownloadCleanupService'
import { DownloadRunner } from './DownloadRunner'
import { DownloadService } from './DownloadService'

export interface DownloadRuntimeOptions {
    getStorageRoot: () => string

    acceptsRequest?: (...args: Parameters<DownloadAdapterSelector>) => boolean

    beforeRun?: (jobId: string) => Promise<void>

    selectAdapter: (
        storageRoot: string,
        ...args: Parameters<DownloadAdapterSelector>
    ) => ReturnType<DownloadAdapterSelector>
}

export interface DownloadRuntime {
    readonly service: DownloadService

    readonly recovery: Pick<DownloadRecoveryRepository, 'inspect' | 'recoverAtStartup'>

    readonly cleanup: Pick<DownloadCleanupService, 'runAtStartup'>
}

// 복구·정리는 프로세스·다운로드·미디어 편집이 멈춘 시작 단계에서만 호출한다.
export function createDownloadRuntime(
    db: V2Database,
    options: DownloadRuntimeOptions
): DownloadRuntime {
    const roots = new DownloadRootRepository(db)

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
                    options.selectAdapter(storageRoot, url, jobOptions)
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

                await options.beforeRun?.(jobId)

                return forRoot(root).runner.run(jobId, trigger)
            },

            cancel: (jobId) => forRoot(roots.get(jobId)).runner.cancel(jobId)
        },
        options.getStorageRoot,
        options.acceptsRequest
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
