import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import * as s from '../../../database/schema-v2'
import type { V2Database } from '@features/media/MediaRepository'
import type { DownloadOptions } from '../../../shared/types'

type Tx = Parameters<Parameters<V2Database['transaction']>[0]>[0]

export type DownloadJobOptions = Pick<
    DownloadOptions,
    'type' | 'quality' | 'playlist' | 'extension'
>

export type EnqueueDownloadInput = {
    requestUrlId: number
    originalUrl: string
    options?: DownloadJobOptions
    recoveryEnabled?: boolean
    autoRunLimit?: number
} & (
    | {
          mode: 'create'
      }
    | {
          mode: 'replace'
          mediaId: number
          expectedRevision: number
      }
)

export interface DownloadTargetMetadata {
    kind: 'image' | 'video' | 'audio' | 'unknown'
    title?: string | null
    externalId?: string | null
    platformName?: string | null
    ownerId?: string | null
    ownerName?: string | null
    duration?: number | null
}

export interface DownloadTargetInput {
    targetKey: string
    sourceUrl: string
    metadata: DownloadTargetMetadata
}

export interface DownloadResultInput {
    targetKey: string
    stagedPath: string
}

export interface DownloadVerificationTarget {
    id: string
    targetKey: string
    sourceUrl: string
    metadataJson: string
    position: number
    stagedPath: string
}

export interface DownloadVerificationSnapshot {
    jobId: string
    attemptId: string
    targets: DownloadVerificationTarget[]
}

export interface DownloadFileVerification {
    targetId: string
    stagedPath: string
    realPath: string
    size: number
    mtimeNs: string
    ctimeNs: string
    device: string
    inode: string
    sha256: string
}

export function parseDownloadJobOptions(value: string): DownloadJobOptions {
    let parsed: unknown

    try {
        if (typeof value !== 'string') throw new Error()
        parsed = JSON.parse(value)
    } catch {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    return JSON.parse(optionsJson(parsed as DownloadJobOptions)) as DownloadJobOptions
}

export type DownloadTrigger = typeof s.downloadAttempts.$inferInsert.trigger

export type DownloadRepositoryErrorCode =
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT'
    | 'ALREADY_PROCESSING'
    | 'REDOWNLOAD_CONFIRMATION_REQUIRED'
    | 'CLEANUP_REQUIRED'
    | 'INVALID_STATE'
    | 'AUTO_RECOVERY_DISABLED'
    | 'AUTO_HISTORY_UNKNOWN'
    | 'AUTO_LIMIT_REACHED'
    | 'INVARIANT_VIOLATION'
    | 'TARGET_DISCOVERY_EMPTY'
    | 'TARGET_DUPLICATE'
    | 'TARGET_PATH_COLLISION'
    | 'TARGET_UNEXPECTED_RESULT'
    | 'TARGET_INCOMPLETE'
    | 'CANCEL_REQUESTED'
    | 'CANNOT_CANCEL_COMMITTING'
    | 'UNSAFE_STAGING_PATH'
    | 'FILE_NOT_FOUND'
    | 'FILE_NOT_REGULAR'
    | 'FILE_EMPTY'
    | 'FILE_CHANGED'
    | 'FILE_IO_ERROR'
    | 'VERIFICATION_CHANGED'
    | 'FILE_IDENTITY_COLLISION'
    | 'DATABASE_ERROR'
    | 'MANIFEST_EXISTS'
    | 'COMMIT_STATE_UNKNOWN'
    | 'DATABASE_ERROR'
    | 'MANIFEST_EXISTS'
    | 'COMMIT_STATE_UNKNOWN'
    | 'UNSUPPORTED_TARGET_DISCOVERY'
    | 'DOWNLOAD_ENGINE_FAILED'
    | 'ENGINE_TIMEOUT'
    | 'ENGINE_OUTPUT_LIMIT'
    | 'ENGINE_STOP_UNCONFIRMED'

export class DownloadRepositoryError extends Error {
    constructor(
        readonly code: DownloadRepositoryErrorCode,
        readonly context: Record<string, string | number> = {}
    ) {
        super(code)
        this.name = 'DownloadRepositoryError'
    }
}

function integer(value: number, min = 0) {
    if (!Number.isSafeInteger(value) || value < min) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }
}

function optionsJson(value: DownloadJobOptions = {}): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    const input = value as Record<string, unknown>

    const prototype = Object.getPrototypeOf(input)

    if (
        (prototype !== Object.prototype && prototype !== null) ||
        Object.keys(input).some(
            (key) => !['type', 'quality', 'playlist', 'extension'].includes(key)
        )
    ) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    const fields: [string, readonly unknown[]][] = [
        ['type', ['video', 'audio']],
        ['quality', ['best', '8k', '4k', '2k', '1080', '720', '480', 'audio']],
        ['playlist', [true, false]],
        ['extension', ['mp4', 'mp3', 'mkv']]
    ]

    for (const [key, allowed] of fields) {
        if (input[key] !== undefined && !allowed.includes(input[key])) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }
    }

    return JSON.stringify(input)
}

function nonemptyText(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }
}

function targetMetadata(value: DownloadTargetMetadata): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    const prototype = Object.getPrototypeOf(value)

    const input = value as unknown as Record<string, unknown>

    const textFields = ['title', 'externalId', 'platformName', 'ownerId', 'ownerName']

    const allowed = ['kind', 'duration', ...textFields]

    if (
        (prototype !== Object.prototype && prototype !== null) ||
        Object.keys(input).some((key) => !allowed.includes(key)) ||
        !['image', 'video', 'audio', 'unknown'].includes(input.kind as string)
    ) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    for (const key of textFields) {
        if (input[key] !== undefined && input[key] !== null && typeof input[key] !== 'string') {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }
    }

    if (
        input.duration !== undefined &&
        input.duration !== null &&
        (typeof input.duration !== 'number' ||
            !Number.isFinite(input.duration) ||
            input.duration < 0)
    ) {
        throw new DownloadRepositoryError('INVALID_ARGUMENT')
    }

    return JSON.stringify(input)
}

export class DownloadRepository {
    constructor(
        private readonly db: V2Database,
        private readonly clock: () => number = Date.now,
        private readonly newId: () => string = randomUUID
    ) {
        const row = db.get<{
            foreign_keys: number
        }>(sql`PRAGMA foreign_keys`)

        if (row?.foreign_keys !== 1) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }
    }

    get(jobId: string) {
        this.id(jobId)

        return this.db.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, jobId)).get()
    }

    list({ limit = 50, offset = 0 } = {}) {
        integer(limit, 1)
        integer(offset)

        if (limit > 200 || !Number.isSafeInteger(limit + offset)) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return this.db
            .select()
            .from(s.downloadQueue)
            .orderBy(desc(s.downloadQueue.createdAt), desc(s.downloadQueue.id))
            .limit(limit)
            .offset(offset)
            .all()
    }

    enqueue(input: EnqueueDownloadInput) {
        integer(input.requestUrlId, Number.MIN_SAFE_INTEGER)

        if (
            typeof input.originalUrl !== 'string' ||
            !input.originalUrl.trim() ||
            !['create', 'replace'].includes(input.mode)
        ) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        const recoveryEnabled = input.recoveryEnabled ?? false

        const autoRunLimit = input.autoRunLimit ?? 1

        if (typeof recoveryEnabled !== 'boolean') {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        integer(autoRunLimit)

        const serializedOptions = optionsJson(input.options)

        return this.write((tx, now) => {
            const request = tx
                .select()
                .from(s.downloadUrls)
                .where(eq(s.downloadUrls.id, input.requestUrlId))
                .get()

            if (!request) {
                throw new DownloadRepositoryError('NOT_FOUND')
            }

            this.assertNoOtherJob(tx, request.id)

            const existing = tx
                .select()
                .from(s.medias)
                .where(eq(s.medias.requestUrlId, request.id))
                .get()

            let mediaId: number | null = null

            if (input.mode === 'create') {
                if (existing) {
                    throw new DownloadRepositoryError('REDOWNLOAD_CONFIRMATION_REQUIRED', {
                        mediaId: existing.id,
                        revision: existing.revision
                    })
                }
            } else {
                integer(input.mediaId, Number.MIN_SAFE_INTEGER)

                integer(input.expectedRevision)

                const media = tx.select().from(s.medias).where(eq(s.medias.id, input.mediaId)).get()

                if (!media) {
                    throw new DownloadRepositoryError('NOT_FOUND')
                }

                if (media.sourceKind !== 'download' || media.requestUrlId !== request.id) {
                    throw new DownloadRepositoryError('INVALID_ARGUMENT')
                }

                if (media.revision !== input.expectedRevision) {
                    throw new DownloadRepositoryError('REVISION_CONFLICT', {
                        mediaId: media.id,
                        expectedRevision: input.expectedRevision,
                        actualRevision: media.revision
                    })
                }

                mediaId = media.id
            }

            return tx
                .insert(s.downloadQueue)
                .values({
                    id: this.id(this.newId()),
                    requestUrlId: request.id,
                    originalUrl: input.originalUrl,
                    mode: input.mode,
                    targetMediaId: mediaId,
                    targetMediaIdSnapshot: mediaId,
                    state: 'pending',
                    optionsJson: serializedOptions,
                    recoveryEnabled,
                    autoRunLimit,
                    autoRunCount: 0,
                    autoHistoryUnknown: false,
                    progress: 0,
                    cleanupRequired: false,
                    createdAt: now,
                    updatedAt: now
                })
                .returning()
                .get()
        })
    }

    startAttempt(jobId: string, trigger: DownloadTrigger) {
        this.id(jobId)

        if (
            !['manual_initial', 'manual_retry', 'manual_restart', 'auto_recovery'].includes(trigger)
        ) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return this.write((tx, now) => {
            const job = tx.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, jobId)).get()

            if (!job) {
                throw new DownloadRepositoryError('NOT_FOUND')
            }

            if (job.cleanupRequired) {
                throw new DownloadRepositoryError('CLEANUP_REQUIRED')
            }

            this.assertNoOtherJob(tx, job.requestUrlId, job.id)

            const unfinished = tx.get<{
                found: number
            }>(sql`
                SELECT EXISTS (
                    SELECT 1
                    FROM download_attempt
                    WHERE job_id = ${job.id}
                      AND outcome IS NULL
                ) AS found
            `)

            if (unfinished?.found) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            const last = tx.get<{
                value: number
            }>(sql`
                SELECT coalesce(
                    max(attempt_no), 0
                ) AS value
                FROM download_attempt
                WHERE job_id = ${job.id}
            `)!.value

            integer(last)
            integer(last + 1, 1)

            const allowed =
                trigger === 'manual_initial'
                    ? job.state === 'pending' && last === 0
                    : trigger === 'manual_retry'
                      ? job.state === 'failed'
                      : trigger === 'manual_restart'
                        ? job.state === 'cancelled' || job.state === 'interrupted'
                        : job.state === 'interrupted'

            if (!allowed) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            let autoRunCount = job.autoRunCount

            if (trigger === 'auto_recovery') {
                if (job.autoHistoryUnknown || autoRunCount === null) {
                    throw new DownloadRepositoryError('AUTO_HISTORY_UNKNOWN')
                }

                if (!job.recoveryEnabled) {
                    throw new DownloadRepositoryError('AUTO_RECOVERY_DISABLED')
                }

                integer(autoRunCount)
                integer(job.autoRunLimit)

                if (autoRunCount >= job.autoRunLimit) {
                    throw new DownloadRepositoryError('AUTO_LIMIT_REACHED')
                }

                autoRunCount++
                integer(autoRunCount)
            }

            const media = tx
                .select()
                .from(s.medias)
                .where(eq(s.medias.requestUrlId, job.requestUrlId))
                .get()

            if (job.mode === 'replace') {
                if (job.targetMediaId === null || !media || media.id !== job.targetMediaId) {
                    throw new DownloadRepositoryError('NOT_FOUND')
                }
            } else if (media) {
                throw new DownloadRepositoryError('REDOWNLOAD_CONFIRMATION_REQUIRED', {
                    mediaId: media.id,
                    revision: media.revision
                })
            }

            const attempt = tx
                .insert(s.downloadAttempts)
                .values({
                    id: this.id(this.newId()),
                    jobId: job.id,
                    attemptNo: last + 1,
                    targetMediaId: job.targetMediaId,
                    targetMediaIdSnapshot: job.targetMediaIdSnapshot,
                    trigger,
                    phase: 'discovering',
                    startedAt: now
                })
                .returning()
                .get()

            const updatedJob = tx
                .update(s.downloadQueue)
                .set({
                    state: 'running',
                    currentAttemptId: attempt.id,
                    autoRunCount,
                    progress: 0,
                    startedAt: now,
                    finishedAt: null,
                    updatedAt: now
                })
                .where(and(eq(s.downloadQueue.id, job.id), eq(s.downloadQueue.state, job.state)))
                .returning()
                .get()

            if (!updatedJob) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            return {
                job: updatedJob,
                attempt
            }
        })
    }

    freezeTargets(jobId: string, attemptId: string, targets: readonly DownloadTargetInput[]) {
        this.id(jobId)
        this.id(attemptId)

        if (!Array.isArray(targets)) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        if (!targets.length) {
            throw new DownloadRepositoryError('TARGET_DISCOVERY_EMPTY')
        }

        const keys = new Set<string>()

        const prepared = Array.from(targets, (target, position) => {
            if (!target || typeof target !== 'object') {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }

            nonemptyText(target.targetKey)
            nonemptyText(target.sourceUrl)

            let url: URL

            try {
                url = new URL(target.sourceUrl)
            } catch {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }

            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }

            if (keys.has(target.targetKey)) {
                throw new DownloadRepositoryError('TARGET_DUPLICATE')
            }

            keys.add(target.targetKey)

            return {
                targetKey: target.targetKey,
                sourceUrl: target.sourceUrl,
                metadataJson: targetMetadata(target.metadata),
                position
            }
        })

        return this.write((tx, now) => {
            this.currentAttempt(tx, jobId, attemptId, 'discovering')

            const existing = tx
                .select({
                    id: s.downloadTargets.id
                })
                .from(s.downloadTargets)
                .where(eq(s.downloadTargets.attemptId, attemptId))
                .limit(1)
                .get()

            if (existing) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            for (const target of prepared) {
                tx.insert(s.downloadTargets)
                    .values({
                        ...target,
                        id: this.id(this.newId()),
                        attemptId,
                        state: 'pending'
                    })
                    .run()
            }

            tx.update(s.downloadAttempts)
                .set({ phase: 'downloading' })
                .where(eq(s.downloadAttempts.id, attemptId))
                .run()

            tx.update(s.downloadQueue)
                .set({ updatedAt: now })
                .where(eq(s.downloadQueue.id, jobId))
                .run()

            return {
                attemptId,
                total: prepared.length
            }
        })
    }

    listTargets(jobId: string, attemptId: string, { limit = 50, offset = 0 } = {}) {
        this.id(jobId)
        this.id(attemptId)

        integer(limit, 1)
        integer(offset)

        if (limit > 200 || !Number.isSafeInteger(limit + offset)) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return this.db.transaction((tx) => {
            const attempt = tx
                .select({
                    id: s.downloadAttempts.id
                })
                .from(s.downloadAttempts)
                .where(
                    and(eq(s.downloadAttempts.id, attemptId), eq(s.downloadAttempts.jobId, jobId))
                )
                .get()

            if (!attempt) {
                throw new DownloadRepositoryError('NOT_FOUND')
            }

            const where = eq(s.downloadTargets.attemptId, attemptId)

            const total = tx.select({ value: count() }).from(s.downloadTargets).where(where).get()!
                .value

            const data = tx
                .select()
                .from(s.downloadTargets)
                .where(where)
                .orderBy(asc(s.downloadTargets.position), asc(s.downloadTargets.id))
                .limit(limit)
                .offset(offset)
                .all()

            return {
                data,
                total,
                hasNextPage: offset + data.length < total
            }
        })
    }

    recordResults(jobId: string, attemptId: string, results: readonly DownloadResultInput[]) {
        this.id(jobId)
        this.id(attemptId)

        if (!Array.isArray(results)) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        const keys = new Set<string>()
        const paths = new Set<string>()

        const prepared = Array.from(results, (result) => {
            if (!result || typeof result !== 'object') {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }

            nonemptyText(result.targetKey)
            nonemptyText(result.stagedPath)

            if (!isAbsolute(result.stagedPath)) {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }

            if (keys.has(result.targetKey)) {
                throw new DownloadRepositoryError('TARGET_DUPLICATE')
            }

            const stagedPath = resolve(result.stagedPath)

            const pathKey = process.platform === 'win32' ? stagedPath.toLowerCase() : stagedPath

            if (paths.has(pathKey)) {
                throw new DownloadRepositoryError('TARGET_PATH_COLLISION')
            }

            keys.add(result.targetKey)
            paths.add(pathKey)

            return {
                targetKey: result.targetKey,
                stagedPath
            }
        })

        return this.write((tx, now) => {
            this.currentAttempt(tx, jobId, attemptId, 'downloading')

            const targets = tx
                .select()
                .from(s.downloadTargets)
                .where(eq(s.downloadTargets.attemptId, attemptId))
                .all()

            if (!targets.length) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            const byKey = new Map(targets.map((target) => [target.targetKey, target]))

            if (prepared.some((result) => !byKey.has(result.targetKey))) {
                throw new DownloadRepositoryError('TARGET_UNEXPECTED_RESULT')
            }

            if (prepared.length !== targets.length) {
                throw new DownloadRepositoryError('TARGET_INCOMPLETE', {
                    expected: targets.length,
                    received: prepared.length
                })
            }

            if (
                targets.some(
                    (target) => target.state !== 'pending' && target.state !== 'downloading'
                )
            ) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            for (const result of prepared) {
                const target = byKey.get(result.targetKey)!

                tx.update(s.downloadTargets)
                    .set({
                        state: 'downloaded',
                        stagedPath: result.stagedPath
                    })
                    .where(eq(s.downloadTargets.id, target.id))
                    .run()
            }

            tx.update(s.downloadAttempts)
                .set({ phase: 'verifying' })
                .where(eq(s.downloadAttempts.id, attemptId))
                .run()

            tx.update(s.downloadQueue)
                .set({ updatedAt: now })
                .where(eq(s.downloadQueue.id, jobId))
                .run()

            return {
                attemptId,
                total: prepared.length
            }
        })
    }

    verificationSnapshot(jobId: string, attemptId: string): DownloadVerificationSnapshot {
        this.id(jobId)
        this.id(attemptId)

        return this.db.transaction((tx) => {
            this.currentAttempt(tx, jobId, attemptId, 'verifying')

            const rows = tx
                .select()
                .from(s.downloadTargets)
                .where(eq(s.downloadTargets.attemptId, attemptId))
                .orderBy(asc(s.downloadTargets.position), asc(s.downloadTargets.id))
                .all()

            if (!rows.length) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            const targets = rows.map((row) => {
                if (row.state !== 'downloaded' || row.finalPath !== null) {
                    throw new DownloadRepositoryError('INVALID_STATE')
                }

                nonemptyText(row.stagedPath)

                targetMetadata(JSON.parse(row.metadataJson) as DownloadTargetMetadata)

                return {
                    id: row.id,
                    targetKey: row.targetKey,
                    sourceUrl: row.sourceUrl,
                    metadataJson: row.metadataJson,
                    position: row.position,
                    stagedPath: row.stagedPath
                }
            })

            return { jobId, attemptId, targets }
        })
    }

    markVerified(
        snapshot: DownloadVerificationSnapshot,
        files: readonly DownloadFileVerification[]
    ) {
        const { jobId, attemptId } = snapshot

        this.id(jobId)
        this.id(attemptId)

        if (!Array.isArray(files) || files.length !== snapshot.targets.length || !files.length) {
            throw new DownloadRepositoryError('VERIFICATION_CHANGED')
        }

        const byId = new Map<string, DownloadFileVerification>()
        const identities = new Set<string>()

        for (const file of files) {
            nonemptyText(file.targetId)
            nonemptyText(file.stagedPath)
            nonemptyText(file.realPath)
            integer(file.size, 1)

            if (
                !isAbsolute(file.stagedPath) ||
                !isAbsolute(file.realPath) ||
                typeof file.mtimeNs !== 'string' ||
                !/^-?\d+$/.test(file.mtimeNs) ||
                typeof file.ctimeNs !== 'string' ||
                !/^-?\d+$/.test(file.ctimeNs) ||
                typeof file.device !== 'string' ||
                !/^\d+$/.test(file.device) ||
                typeof file.inode !== 'string' ||
                !/^[1-9]\d*$/.test(file.inode) ||
                typeof file.sha256 !== 'string' ||
                !/^[0-9a-f]{64}$/.test(file.sha256) ||
                byId.has(file.targetId)
            ) {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }

            const identity = file.device + ':' + file.inode

            if (identities.has(identity)) {
                throw new DownloadRepositoryError('FILE_IDENTITY_COLLISION')
            }

            identities.add(identity)
            byId.set(file.targetId, { ...file })
        }

        return this.write((tx, now) => {
            this.currentAttempt(tx, jobId, attemptId, 'verifying')

            const rows = tx
                .select()
                .from(s.downloadTargets)
                .where(eq(s.downloadTargets.attemptId, attemptId))
                .orderBy(asc(s.downloadTargets.position), asc(s.downloadTargets.id))
                .all()

            const changed =
                rows.length !== snapshot.targets.length ||
                rows.some((row, index) => {
                    const before = snapshot.targets[index]

                    return (
                        row.id !== before.id ||
                        row.targetKey !== before.targetKey ||
                        row.sourceUrl !== before.sourceUrl ||
                        row.metadataJson !== before.metadataJson ||
                        row.position !== before.position ||
                        row.stagedPath !== before.stagedPath ||
                        row.state !== 'downloaded' ||
                        row.finalPath !== null ||
                        byId.get(row.id)?.stagedPath !== row.stagedPath
                    )
                })

            if (changed) {
                throw new DownloadRepositoryError('VERIFICATION_CHANGED')
            }

            for (const row of rows) {
                const file = byId.get(row.id)!
                const metadata = JSON.parse(row.metadataJson) as DownloadTargetMetadata

                tx.update(s.downloadTargets)
                    .set({
                        state: 'verified',
                        metadataJson: JSON.stringify({
                            ...metadata,
                            fileVerification: {
                                version: 1,
                                ...file
                            }
                        })
                    })
                    .where(eq(s.downloadTargets.id, row.id))
                    .run()
            }

            tx.update(s.downloadQueue)
                .set({ updatedAt: now })
                .where(eq(s.downloadQueue.id, jobId))
                .run()

            return { attemptId, total: rows.length }
        })
    }

    private currentAttempt(
        tx: Tx,
        jobId: string,
        attemptId: string,
        phase: 'discovering' | 'downloading' | 'verifying'
    ) {
        const job = tx.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, jobId)).get()

        const attempt = tx
            .select()
            .from(s.downloadAttempts)
            .where(and(eq(s.downloadAttempts.id, attemptId), eq(s.downloadAttempts.jobId, jobId)))
            .get()

        if (!job || !attempt) {
            throw new DownloadRepositoryError('NOT_FOUND')
        }

        if (job.cleanupRequired) {
            throw new DownloadRepositoryError('CLEANUP_REQUIRED')
        }

        if (
            job.state !== 'running' ||
            job.currentAttemptId !== attemptId ||
            attempt.phase !== phase ||
            attempt.outcome !== null ||
            attempt.committedAt !== null ||
            attempt.targetMediaId !== job.targetMediaId
        ) {
            throw new DownloadRepositoryError('INVALID_STATE')
        }

        if (attempt.cancelRequestedAt !== null) {
            throw new DownloadRepositoryError('CANCEL_REQUESTED')
        }
    }

    private assertNoOtherJob(tx: Tx, requestUrlId: number, exceptId: string | null = null) {
        const other = tx.get<{
            id: string
            cleanup: number
        }>(sql`
            SELECT
                q.id,
                q.cleanup_required AS cleanup
            FROM download_queue q
            WHERE q.request_url_id = ${requestUrlId}
              AND (
                  ${exceptId} IS NULL
                  OR q.id <> ${exceptId}
              )
              AND (
                  q.state IN ('pending', 'running')
                  OR q.cleanup_required = 1
                  OR EXISTS (
                      SELECT 1
                      FROM download_attempt a
                      WHERE a.job_id = q.id
                        AND a.outcome IS NULL
                  )
              )
            ORDER BY
                q.cleanup_required DESC,
                q.id
            LIMIT 1
        `)

        if (other) {
            throw new DownloadRepositoryError(
                other.cleanup ? 'CLEANUP_REQUIRED' : 'ALREADY_PROCESSING',
                { jobId: other.id }
            )
        }
    }

    private write<T>(action: (tx: Tx, now: number) => T): T {
        return this.db.transaction(
            (tx) => {
                const now = this.clock()
                integer(now)

                return action(tx, now)
            },
            { behavior: 'immediate' }
        )
    }

    private id(value: string): string {
        if (typeof value !== 'string' || !value.trim()) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return value
    }
}
