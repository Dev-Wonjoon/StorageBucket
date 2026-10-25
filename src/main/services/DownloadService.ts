import { and, eq, isNull } from 'drizzle-orm'
import * as s from '../../database/schema-v2'
import {
    downloadFailure,
    type DownloadJobDto,
    type DownloadResponse,
    type DownloadServicePort,
    type ManualDownloadTrigger
} from '../../shared/download-api'
import type { V2Database } from '../repositories/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError,
    parseDownloadJobOptions,
    type DownloadJobOptions
} from '../repositories/DownloadRepository'
import type { DownloadRunner } from './DownloadRunner'
import { DownloadRootRepository } from '../repositories/DownloadRootRepository'

function invalid(): never {
    throw new DownloadRepositoryError('INVALID_ARGUMENT')
}

function object(value: unknown, allowed: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid()
    }

    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) {
        invalid()
    }

    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        invalid()
    }

    return value as Record<string, unknown>
}

function integer(value: unknown, min: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
        invalid()
    }

    return value
}

function jobId(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
        invalid()
    }

    return value
}

function requestUrl(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f]/.test(value)) {
        invalid()
    }

    try {
        const url = new URL(value)

        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            invalid()
        }

        return {
            original: value,
            normalized: url.toString()
        }
    } catch {
        return invalid()
    }
}

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

export class DownloadService implements DownloadServicePort {
    private readonly jobs: DownloadRepository
    private executionTail: Promise<void> = Promise.resolve()
    private readonly requestedRuns = new Set<string>()
    private executionBlocked: string | null = null

    constructor(
        private readonly db: V2Database,
        private readonly runner: Pick<DownloadRunner, 'run' | 'cancel'>,
        private readonly getStorageRoot: () => string,
        private readonly acceptsRequest?: (
            url: string,
            options: Readonly<DownloadJobOptions>
        ) => boolean
    ) {
        this.jobs = new DownloadRepository(db)
    }

    private async execute<T>(action: () => T | Promise<T>): Promise<DownloadResponse<T>> {
        try {
            return {
                ok: true,
                data: await action()
            }
        } catch (error) {
            if (!(error instanceof DownloadRepositoryError)) {
                return downloadFailure('INTERNAL_ERROR')
            }

            const result = downloadFailure(error.code)

            if (!result.ok) {
                for (const key of ['mediaId', 'revision', 'expectedRevision', 'actualRevision']) {
                    const value = error.context[key]

                    if (typeof value === 'number' && Number.isSafeInteger(value)) {
                        result.error.context[key] = value
                    }
                }
            }

            return result
        }
    }

    private dto(row: typeof s.downloadQueue.$inferSelect): DownloadJobDto {
        const attempt =
            row.currentAttemptId === null
                ? undefined
                : this.db
                      .select({
                          phase: s.downloadAttempts.phase
                      })
                      .from(s.downloadAttempts)
                      .where(
                          and(
                              eq(s.downloadAttempts.jobId, row.id),
                              eq(s.downloadAttempts.id, row.currentAttemptId)
                          )
                      )
                      .get()

        if (row.currentAttemptId !== null && !attempt) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }

        let options: DownloadJobDto['options'] = null

        try {
            options = parseDownloadJobOptions(row.optionsJson)
        } catch (error) {
            if (!(error instanceof DownloadRepositoryError)) {
                throw error
            }
        }

        return {
            id: row.id,
            url: row.originalUrl,
            title: row.title,
            state: row.state,
            phase: attempt?.phase ?? null,
            progress: row.progress,
            options,
            cleanupRequired: row.cleanupRequired,
            currentAttemptId: row.currentAttemptId,
            errorCode:
                row.errorCode && /^[A-Z][A-Z0-9_]{0,79}$/.test(row.errorCode) ? row.errorCode : null
        }
    }

    enqueue(request: unknown) {
        return this.execute(() => {
            const input = object(request, ['url', 'options', 'mode', 'mediaId', 'expectedRevision'])

            const url = requestUrl(input.url)

            const options = parseDownloadJobOptions(
                JSON.stringify(
                    input.options === undefined
                        ? {}
                        : object(input.options, ['type', 'quality', 'playlist', 'extension'])
                )
            )

            const mode =
                input.mode === 'create'
                    ? {
                          mode: 'create' as const
                      }
                    : input.mode === 'replace'
                      ? {
                            mode: 'replace' as const,
                            mediaId: integer(input.mediaId, Number.MIN_SAFE_INTEGER),
                            expectedRevision: integer(input.expectedRevision, 0)
                        }
                      : invalid()

            if (mode.mode === 'create' && ('mediaId' in input || 'expectedRevision' in input)) {
                invalid()
            }

            // 같은 DB 연결을 사용하므로 URL 등록과 작업 생성을
            // 함께 롤백할 수 있다.
            if (this.acceptsRequest && !this.acceptsRequest(url.original, options)) {
                throw new DownloadRepositoryError('UNSUPPORTED_TARGET_DISCOVERY')
            }
            const selectedRoot = this.getStorageRoot()

            return database(() =>
                this.db.transaction(
                    (tx) => {
                        tx.insert(s.downloadUrls)
                            .values({
                                url: url.original,
                                normalizedUrl: url.normalized,
                                normalizationVersion: 1
                            })
                            .onConflictDoNothing({
                                target: [
                                    s.downloadUrls.normalizationVersion,
                                    s.downloadUrls.normalizedUrl
                                ]
                            })
                            .run()

                        const saved = tx
                            .select({
                                id: s.downloadUrls.id
                            })
                            .from(s.downloadUrls)
                            .where(
                                and(
                                    eq(s.downloadUrls.normalizationVersion, 1),
                                    eq(s.downloadUrls.normalizedUrl, url.normalized)
                                )
                            )
                            .get()

                        if (!saved) {
                            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
                        }

                        const job = this.jobs.enqueue({
                            ...mode,
                            requestUrlId: saved.id,
                            originalUrl: url.original,
                            options
                        })

                        new DownloadRootRepository(tx).bind(job.id, selectedRoot)

                        return this.dto(job)
                    },
                    { behavior: 'immediate' }
                )
            )
        })
    }

    list(request: unknown = {}) {
        return this.execute(() => {
            const input = object(request, ['limit', 'offset'])

            const limit = input.limit === undefined ? 50 : integer(input.limit, 1)

            const offset = input.offset === undefined ? 0 : integer(input.offset, 0)

            if (limit > 100 || !Number.isSafeInteger(offset + limit + 1)) {
                invalid()
            }

            return database(() =>
                this.db.transaction(() => {
                    const rows = this.jobs.list({
                        limit: limit + 1,
                        offset
                    })

                    return {
                        data: rows.slice(0, limit).map((row) => this.dto(row)),
                        limit,
                        offset,
                        hasNextPage: rows.length > limit
                    }
                })
            )
        })
    }

    get(request: unknown) {
        return this.execute(() => {
            const id = jobId(object(request, ['jobId']).jobId)

            return database(() =>
                this.db.transaction(() => {
                    const row = this.jobs.get(id)

                    if (!row) {
                        throw new DownloadRepositoryError('NOT_FOUND')
                    }

                    return this.dto(row)
                })
            )
        })
    }

    run(request: unknown) {
        return this.execute(async () => {
            const input = object(request, ['jobId', 'trigger'])
            const id = jobId(input.jobId)

            if (
                !['manual_initial', 'manual_retry', 'manual_restart'].includes(
                    input.trigger as string
                )
            ) {
                invalid()
            }

            if (this.requestedRuns.has(id)) {
                throw new DownloadRepositoryError('ALREADY_PROCESSING')
            }

            this.requestedRuns.add(id)

            const previous = this.executionTail
            let release!: () => void

            this.executionTail = new Promise<void>((done) => {
                release = done
            })

            await previous

            try {
                if (this.executionBlocked) {
                    return {
                        status: 'blocked' as const,
                        jobId: id,
                        reason: this.executionBlocked
                    }
                }

                const job = database(() => this.jobs.get(id))

                if (!job) {
                    throw new DownloadRepositoryError('NOT_FOUND')
                }

                parseDownloadJobOptions(job.optionsJson)

                const result = await this.runner.run(id, input.trigger as ManualDownloadTrigger)

                if (result.status === 'blocked') {
                    this.executionBlocked = result.reason
                }

                return result
            } catch (error) {
                if (!(error instanceof DownloadRepositoryError)) {
                    this.executionBlocked = 'INCONSISTENT_STATE'
                } else if (['DATABASE_ERROR', 'COMMIT_STATE_UNKNOWN'].includes(error.code)) {
                    this.executionBlocked = 'DATABASE_UNAVAILABLE'
                } else if (error.code === 'ENGINE_STOP_UNCONFIRMED') {
                    this.executionBlocked = 'ENGINE_STATE_UNKNOWN'
                }

                throw error
            } finally {
                this.requestedRuns.delete(id)
                release()
            }
        })
    }

    cancel(request: unknown) {
        return this.execute(() => {
            const id = jobId(object(request, ['jobId']).jobId)

            const pending = database(() =>
                this.db.transaction(
                    (tx) => {
                        const row = this.jobs.get(id)

                        if (!row) {
                            throw new DownloadRepositoryError('NOT_FOUND')
                        }

                        if (row.cleanupRequired) {
                            throw new DownloadRepositoryError('CLEANUP_REQUIRED')
                        }

                        if (row.state !== 'pending') {
                            return false
                        }

                        const unfinished = tx
                            .select({
                                id: s.downloadAttempts.id
                            })
                            .from(s.downloadAttempts)
                            .where(
                                and(
                                    eq(s.downloadAttempts.jobId, id),
                                    isNull(s.downloadAttempts.outcome)
                                )
                            )
                            .get()

                        if (row.currentAttemptId !== null || unfinished) {
                            throw new DownloadRepositoryError('INVALID_STATE')
                        }

                        const now = Date.now()

                        const changed = tx
                            .update(s.downloadQueue)
                            .set({
                                state: 'cancelled',
                                finishedAt: now,
                                updatedAt: now
                            })
                            .where(
                                and(
                                    eq(s.downloadQueue.id, id),
                                    eq(s.downloadQueue.state, 'pending')
                                )
                            )
                            .returning({
                                id: s.downloadQueue.id
                            })
                            .get()

                        if (!changed) {
                            throw new DownloadRepositoryError('INVALID_STATE')
                        }

                        return true
                    },
                    { behavior: 'immediate' }
                )
            )

            if (!pending) {
                this.runner.cancel(id)
            }

            return {
                accepted: true as const
            }
        })
    }
}
