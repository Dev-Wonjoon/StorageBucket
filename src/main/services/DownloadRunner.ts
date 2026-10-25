import { isAbsolute, resolve, toNamespacedPath } from 'node:path'
import {
    DownloadRepository,
    DownloadRepositoryError,
    parseDownloadJobOptions,
    type DownloadTrigger
} from '../repositories/DownloadRepository'
import type { DownloadCommitRepository } from '../repositories/DownloadCommitRepository'
import type {
    DownloadRecoveryRepository,
    DownloadRecoveryDecision,
    DownloadRecoveryReason
} from '../repositories/DownloadRecoveryRepository'
import type { DownloadVerificationService } from './DownloadVerificationService'
import { downloadStagingDirectory } from './DownloadVerificationService'
import type { DownloadStorageService } from './DownloadStorageService'
import type {
    DownloadAdapterSelector,
    DownloadWorkspacePort,
    FrozenDownloadTarget
} from './DownloadAdapter'

export interface DownloadRunnerPorts {
    repository: Pick<
        DownloadRepository,
        'startAttempt' | 'freezeTargets' | 'listTargets' | 'recordResults'
    >
    commits: Pick<DownloadCommitRepository, 'requestCancel'>
    recovery: Pick<
        DownloadRecoveryRepository,
        'inspect' | 'finishAfterEngineExit'
    >
    verification: Pick<DownloadVerificationService, 'verify'>
    storage: Pick<DownloadStorageService, 'finalize'>
    workspace: DownloadWorkspacePort
    selectAdapter: DownloadAdapterSelector
}

export type DownloadRunResult = Extract<
    DownloadRecoveryDecision,
    { status: 'committed' | 'cleanup_required' | 'blocked' }
>

type Active = {
    jobId: string
    attemptId: string | null
    controller: AbortController
}

const active = new Map<string, Active>()
const halted = new Map<string, DownloadRecoveryReason>()

function database<T>(action: () => T): T {
    try {
        return action()
    } catch (error) {
        if (error instanceof DownloadRepositoryError) {
            throw error
        }

        throw new DownloadRepositoryError('DATABASE_ERROR')
    }
}

function check(signal: AbortSignal) {
    if (signal.aborted) {
        throw new DownloadRepositoryError('CANCEL_REQUESTED')
    }
}

export class DownloadRunner {
    private readonly root: string
    private readonly owner: string

    constructor(
        private ports: DownloadRunnerPorts,
        storageRoot: string
    ) {
        if (!isAbsolute(storageRoot) || storageRoot.includes('\0')) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        this.root = resolve(storageRoot)

        this.owner =
            process.platform === 'win32'
                ? toNamespacedPath(this.root).toLowerCase()
                : this.root
    }

    cancel(jobId: string) {
        const current = active.get(this.owner)

        if (
            !current ||
            current.jobId !== jobId ||
            current.attemptId === null
        ) {
            throw new DownloadRepositoryError('INVALID_STATE')
        }

        try {
            this.ports.commits.requestCancel(
                jobId,
                current.attemptId
            )
        } catch (error) {
            if (
                error instanceof DownloadRepositoryError &&
                error.code !== 'DATABASE_ERROR' &&
                error.code !== 'COMMIT_STATE_UNKNOWN'
            ) {
                throw error
            }

            halted.set(this.owner, 'DATABASE_UNAVAILABLE')
            current.controller.abort()

            throw new DownloadRepositoryError('DATABASE_ERROR')
        }

        current.controller.abort()
    }

    async run(
        jobId: string,
        trigger: DownloadTrigger
    ): Promise<DownloadRunResult> {
        if (halted.has(this.owner)) {
            return this.block(jobId, halted.get(this.owner)!)
        }

        if (active.has(this.owner)) {
            throw new DownloadRepositoryError('ALREADY_PROCESSING')
        }

        const current: Active = {
            jobId,
            attemptId: null,
            controller: new AbortController()
        }

        active.set(this.owner, current)

        const { signal } = current.controller

        try {
            const { job, attempt } = database(() =>
                this.ports.repository.startAttempt(jobId, trigger)
            )

            current.attemptId = attempt.id

            const options = Object.freeze(
                parseDownloadJobOptions(job.optionsJson)
            )

            const adapter = this.ports.selectAdapter(
                job.originalUrl,
                options
            )

            if (!adapter) {
                throw new DownloadRepositoryError(
                    'UNSUPPORTED_TARGET_DISCOVERY'
                )
            }

            const context = Object.freeze({
                jobId,
                attemptId: attempt.id,
                stagingDirectory: downloadStagingDirectory(
                    this.root,
                    jobId,
                    attempt.id
                )
            })

            try {
                await this.ports.workspace.prepare(context)
            } catch (error) {
                if (error instanceof DownloadRepositoryError) {
                    throw error
                }

                throw new DownloadRepositoryError('FILE_IO_ERROR')
            }

            check(signal)

            const discovered = await adapter.discover({
                ...context,
                originalUrl: job.originalUrl,
                options,
                signal
            })

            check(signal)

            const frozen = database(() =>
                this.ports.repository.freezeTargets(
                    jobId,
                    attempt.id,
                    discovered
                )
            )

            const targets: FrozenDownloadTarget[] = []
            let offset = 0

            for (;;) {
                const page = database(() =>
                    this.ports.repository.listTargets(
                        jobId,
                        attempt.id,
                        { limit: 200, offset }
                    )
                )

                if (
                    page.total !== frozen.total ||
                    (page.hasNextPage && !page.data.length)
                ) {
                    throw new DownloadRepositoryError(
                        'VERIFICATION_CHANGED'
                    )
                }

                for (const row of page.data) {
                    targets.push(
                        Object.freeze({
                            id: row.id,
                            position: row.position,
                            targetKey: row.targetKey,
                            sourceUrl: row.sourceUrl,
                            metadata: Object.freeze(
                                JSON.parse(row.metadataJson)
                            )
                        })
                    )
                }

                offset += page.data.length

                if (!page.hasNextPage) break
            }

            const results = await adapter.downloadFrozen({
                ...context,
                targets: Object.freeze(targets),
                options,
                signal
            })

            check(signal)

            database(() =>
                this.ports.repository.recordResults(
                    jobId,
                    attempt.id,
                    results
                )
            )

            await this.ports.verification.verify(
                jobId,
                attempt.id,
                signal
            )

            check(signal)

            await this.ports.storage.finalize(
                jobId,
                attempt.id,
                signal
            )

            const decision = database(() =>
                this.ports.recovery.inspect(jobId)
            )

            if (decision.status === 'committed') {
                return decision
            }

            if (decision.status === 'blocked') {
                halted.set(this.owner, decision.reason)
                return decision
            }

            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        } catch (error) {
            if (
                error instanceof DownloadRepositoryError &&
                error.code === 'ENGINE_STOP_UNCONFIRMED'
            ) {
                return this.block(jobId, 'ENGINE_STATE_UNKNOWN')
            }

            if (current.attemptId === null) {
                if (
                    error instanceof DownloadRepositoryError &&
                    error.code !== 'DATABASE_ERROR'
                ) {
                    throw error
                }

                return this.block(jobId)
            }

            const code =
                error instanceof DownloadRepositoryError
                    ? error.code
                    : 'DOWNLOAD_ENGINE_FAILED'

            try {
                const decision =
                    this.ports.recovery.finishAfterEngineExit(
                        jobId,
                        current.attemptId,
                        code
                    )

                if (
                    decision.status === 'committed' ||
                    decision.status === 'cleanup_required'
                ) {
                    return decision
                }

                if (decision.status === 'blocked') {
                    halted.set(this.owner, decision.reason)
                    return decision
                }
            } catch {
                return this.block(jobId)
            }

            return this.block(jobId)
        } finally {
            active.delete(this.owner)
        }
    }

    private block(
        jobId: string,
        reason: DownloadRecoveryReason = 'DATABASE_UNAVAILABLE'
    ): DownloadRunResult {
        halted.set(this.owner, reason)

        return {
            status: 'blocked',
            jobId,
            reason
        }
    }
}