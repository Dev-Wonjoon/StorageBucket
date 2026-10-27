import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import * as s from '../../../database/schema-v2'
import type { V2Database } from '@features/media/MediaRepository'
import type { DownloadThumbnailTaskPayload } from '../download/DownloadCommitRepository'
import { DownloadRootRepository } from '../download/DownloadRootRepository'
import type { ThumbnailStatusDto } from '../../../shared/thumbnail-api'

type Tx = Parameters<Parameters<V2Database['transaction']>[0]>[0]
type Task = typeof s.maintenanceTasks.$inferSelect

export interface ThumbnailFileProof {
    path: string
    realPath: string
    size: number
    sha256: string
    device: string
    inode: string
    mtimeNs: string
    ctimeNs: string
    width: number
    height: number
}

interface StoredPayload extends DownloadThumbnailTaskPayload {
    artifact?: ThumbnailFileProof
    finalArtifact?: ThumbnailFileProof
}

export interface ThumbnailWork {
    taskId: string
    attemptId: string
    storageRoot: string
    mediaId: number
    fileId: number
    fileKey: string
    contentHash: string
    sourceUrl: string
    transformVersion: 'jpeg-v1'
    artifact?: ThumbnailFileProof
}

export type ThumbnailRetryResult =
    | { accepted: true }
    | {
          accepted: false
          reason: 'not_retryable' | 'source_busy' | 'source_changed'
      }

export function downloadThumbnailPaths(work: ThumbnailWork) {
    const owner = createHash('sha256')
        .update(
            JSON.stringify([
                work.taskId,
                work.attemptId,
                work.fileId,
                work.contentHash,
                work.transformVersion
            ])
        )
        .digest('hex')

    const directory = join(work.storageRoot, '.storagebucket', 'thumbnails', owner)

    return {
        directory,
        stagedPath: join(directory, 'thumbnail.pending.jpg'),
        finalPath: join(directory, 'thumbnail.jpg')
    }
}

function samePath(left: string, right: string): boolean {
    const normalize = (value: string) => {
        const normalized = resolve(value)

        return process.platform === 'win32' ? normalized.toLowerCase() : normalized
    }

    return normalize(left) === normalize(right)
}

function validateProof(proof: ThumbnailFileProof, expectedPath: string): void {
    if (
        !proof ||
        !isAbsolute(proof.path) ||
        !isAbsolute(proof.realPath) ||
        !samePath(proof.path, expectedPath) ||
        !samePath(proof.realPath, expectedPath) ||
        !Number.isSafeInteger(proof.size) ||
        proof.size <= 0 ||
        proof.size > 8 * 1024 * 1024 ||
        !/^[0-9a-f]{64}$/.test(proof.sha256) ||
        !/^\d+$/.test(proof.device) ||
        !/^[1-9]\d*$/.test(proof.inode) ||
        !/^-?\d+$/.test(proof.mtimeNs) ||
        !/^-?\d+$/.test(proof.ctimeNs) ||
        !Number.isSafeInteger(proof.width) ||
        !Number.isSafeInteger(proof.height) ||
        proof.width < 1 ||
        proof.height < 1 ||
        Math.max(proof.width, proof.height) > 480
    ) {
        throw new Error('THUMBNAIL_PROOF_INVALID')
    }
}

function assertSameWork(expected: ThumbnailWork, current: ThumbnailWork): void {
    const keys = [
        'taskId',
        'attemptId',
        'storageRoot',
        'mediaId',
        'fileId',
        'fileKey',
        'contentHash',
        'sourceUrl',
        'transformVersion'
    ] as const

    if (keys.some((key) => expected[key] !== current[key])) {
        throw new Error('THUMBNAIL_SOURCE_CHANGED')
    }
}

export class DownloadThumbnailRepository {
    constructor(private readonly db: V2Database) {}

    pending(): string[] {
        return this.db
            .select({ id: s.maintenanceTasks.id })
            .from(s.maintenanceTasks)
            .where(
                and(
                    eq(s.maintenanceTasks.kind, 'preview_generation'),
                    eq(s.maintenanceTasks.ownerKind, 'download'),
                    eq(s.maintenanceTasks.state, 'pending'),
                    sql`json_extract(
                        ${s.maintenanceTasks.payloadJson},
                        '$.purpose'
                    ) = 'download_thumbnail'`
                )
            )
            .orderBy(asc(s.maintenanceTasks.updatedAt), asc(s.maintenanceTasks.id))
            .limit(20)
            .all()
            .map((row) => row.id)
    }

    enqueueMissing(): number {
        return this.db.transaction((tx) => {
            const rows = tx.all<{
                mediaId: number
                fileId: number
                fileKey: string
                contentHash: string
                attemptId: string
            }>(sql`
            SELECT
                m.id AS mediaId,
                f.id AS fileId,
                f.file_key AS fileKey,
                f.content_hash AS contentHash,
                a.id AS attemptId
            FROM media_file f
            JOIN media m ON m.id = f.media_id
            JOIN download_attempt a
                ON a.id = m.last_download_commit_attempt_id
            JOIN download_job_storage storage
                ON storage.job_id = a.job_id
            JOIN download_target t
                ON t.attempt_id = a.id
                AND t.target_key = f.file_key
                AND t.final_path = f.filepath
            WHERE m.source_kind = 'download'
                AND f.storage_kind = 'app_managed'
                AND f.kind IN ('video', 'audio')
                AND f.thumbnail_path IS NULL
                AND f.thumbnail_origin = 'none'
                AND f.hash_algorithm = 'sha256'
                AND length(f.content_hash) = 64
                AND f.content_hash NOT GLOB '*[^0-9a-f]*'
                AND length(f.external_id) = 11
                AND f.external_id NOT GLOB '*[^A-Za-z0-9_-]*'
                AND f.file_key = ('youtube:' || f.external_id)
                AND a.outcome = 'completed'
                AND a.committed_at IS NOT NULL
                AND a.target_media_id = m.id
                AND json_extract(
                    t.metadata_json, '$.platformName'
                ) = 'Youtube'
                AND json_extract(
                    t.metadata_json, '$.externalId'
                ) = f.external_id
                AND NOT EXISTS (
                    SELECT 1
                    FROM maintenance_task existing
                    WHERE existing.kind = 'preview_generation'
                        AND existing.owner_kind = 'download'
                        AND existing.download_attempt_id = a.id
                        AND json_extract(
                            existing.payload_json, '$.purpose'
                        ) = 'download_thumbnail'
                        AND json_extract(
                            existing.payload_json, '$.fileId'
                        ) = f.id
                        AND json_extract(
                            existing.payload_json, '$.contentHash'
                        ) = f.content_hash
                        AND json_extract(
                            existing.payload_json, '$.transformVersion'
                        ) = 'jpeg-v1'
                )
            ORDER BY f.id
            LIMIT 100
        `)

            const now = Date.now()

            for (const row of rows) {
                const payload: DownloadThumbnailTaskPayload = {
                    version: 1,
                    purpose: 'download_thumbnail',
                    mediaId: row.mediaId,
                    fileId: row.fileId,
                    fileKey: row.fileKey,
                    contentHash: row.contentHash,
                    transformVersion: 'jpeg-v1'
                }

                tx.insert(s.maintenanceTasks)
                    .values({
                        id: randomUUID(),
                        kind: 'preview_generation',
                        state: 'pending',
                        ownerKind: 'download',
                        downloadAttemptId: row.attemptId,
                        payloadJson: JSON.stringify(payload),
                        createdAt: now,
                        updatedAt: now
                    })
                    .run()
            }

            return rows.length
        })
    }

    private assertIdle(tx: Tx, mediaId: number): void {
        const running = tx
            .select({ id: s.downloadQueue.id })
            .from(s.downloadQueue)
            .where(
                and(
                    eq(s.downloadQueue.state, 'running'),
                    eq(s.downloadQueue.targetMediaId, mediaId)
                )
            )
            .get()

        if (running) {
            throw new Error('THUMBNAIL_SOURCE_BUSY')
        }
    }

    defer(taskId: string): void {
        this.db
            .update(s.maintenanceTasks)
            .set({
                state: 'pending',
                lastError: 'THUMBNAIL_SOURCE_BUSY',
                updatedAt: Date.now()
            })
            .where(
                and(
                    eq(s.maintenanceTasks.id, taskId),
                    eq(s.maintenanceTasks.kind, 'preview_generation'),
                    eq(s.maintenanceTasks.ownerKind, 'download'),
                    inArray(s.maintenanceTasks.state, ['pending', 'running']),
                    sql`json_extract(
                    ${s.maintenanceTasks.payloadJson},
                    '$.purpose'
                ) = 'download_thumbnail'`
                )
            )
            .run()
    }

    // 앱 시작 시, 이전 실행기가 종료된 것이 확실한 단계에서만 호출한다.
    // 파일이나 검증 기록은 삭제하지 않는다.
    recoverAtStartup(): void {
        this.db
            .update(s.maintenanceTasks)
            .set({
                state: 'pending',
                updatedAt: Date.now()
            })
            .where(
                and(
                    eq(s.maintenanceTasks.kind, 'preview_generation'),
                    eq(s.maintenanceTasks.ownerKind, 'download'),
                    eq(s.maintenanceTasks.state, 'running'),
                    sql`json_extract(
                        ${s.maintenanceTasks.payloadJson},
                        '$.purpose'
                    ) = 'download_thumbnail'`
                )
            )
            .run()
    }

    claim(taskId: string): ThumbnailWork | null {
        return this.db.transaction((tx) => {
            const task = tx
                .select()
                .from(s.maintenanceTasks)
                .where(eq(s.maintenanceTasks.id, taskId))
                .get()

            if (!task || task.state !== 'pending') return null

            const { work } = this.inspect(tx, task)
            this.assertIdle(tx, work.mediaId)

            if (!Number.isSafeInteger(task.tryCount) || task.tryCount >= Number.MAX_SAFE_INTEGER) {
                throw new Error('THUMBNAIL_TASK_INVALID')
            }

            tx.update(s.maintenanceTasks)
                .set({
                    state: 'running',
                    tryCount: task.tryCount + 1,
                    lastError: null,
                    updatedAt: Date.now()
                })
                .where(eq(s.maintenanceTasks.id, taskId))
                .run()

            return work
        })
    }

    // 서비스가 전용 임시 JPG를 검사한 뒤,
    // 최종 경로로 이동하기 전에 호출한다.
    recordPrepared(work: ThumbnailWork, proof: ThumbnailFileProof): void {
        this.db.transaction((tx) => {
            const task = this.runningTask(tx, work.taskId)
            const current = this.inspect(tx, task)

            assertSameWork(work, current.work)

            validateProof(proof, downloadThumbnailPaths(current.work).stagedPath)

            tx.update(s.maintenanceTasks)
                .set({
                    payloadJson: JSON.stringify({
                        ...current.payload,
                        artifact: proof
                    }),
                    updatedAt: Date.now()
                })
                .where(eq(s.maintenanceTasks.id, work.taskId))
                .run()
        })
    }

    // 최종 JPG를 다시 검사한 main 서비스만 호출한다.
    // 이 메서드는 파일 I/O를 하지 않는다.
    complete(work: ThumbnailWork, proof: ThumbnailFileProof): void {
        this.db.transaction((tx) => {
            const task = this.runningTask(tx, work.taskId)
            const current = this.inspect(tx, task)

            assertSameWork(work, current.work)
            this.assertIdle(tx, current.work.mediaId)

            const paths = downloadThumbnailPaths(current.work)
            const before = current.payload.artifact

            if (!before) {
                throw new Error('THUMBNAIL_PROOF_MISSING')
            }

            validateProof(before, paths.stagedPath)
            validateProof(proof, paths.finalPath)

            if (
                before.sha256 !== proof.sha256 ||
                before.size !== proof.size ||
                before.device !== proof.device ||
                before.inode !== proof.inode ||
                before.mtimeNs !== proof.mtimeNs ||
                before.width !== proof.width ||
                before.height !== proof.height
            ) {
                throw new Error('THUMBNAIL_FILE_CHANGED')
            }

            tx.update(s.mediaFiles)
                .set({
                    thumbnailPath: paths.finalPath,
                    thumbnailOrigin: 'app_generated',
                    cacheKey: proof.sha256,
                    imageEngineVersion: 'electron-nativeImage',
                    transformVersion: work.transformVersion
                })
                .where(eq(s.mediaFiles.id, work.fileId))
                .run()

            tx.update(s.maintenanceTasks)
                .set({
                    state: 'completed',
                    lastError: null,
                    payloadJson: JSON.stringify({
                        ...current.payload,
                        finalArtifact: proof
                    }),
                    updatedAt: Date.now()
                })
                .where(eq(s.maintenanceTasks.id, work.taskId))
                .run()

            // 제목·태그 등의 편집 revision은 변경하지 않는다.
        })
    }

    fail(taskId: string, code: string): void {
        const errorCode = /^[A-Z_]{1,64}$/.test(code) ? code : 'THUMBNAIL_FAILED'

        this.db
            .update(s.maintenanceTasks)
            .set({
                state: 'failed',
                lastError: errorCode,
                updatedAt: Date.now()
            })
            .where(
                and(
                    eq(s.maintenanceTasks.id, taskId),
                    eq(s.maintenanceTasks.kind, 'preview_generation'),
                    eq(s.maintenanceTasks.ownerKind, 'download'),
                    inArray(s.maintenanceTasks.state, ['pending', 'running']),
                    sql`json_extract(
                        ${s.maintenanceTasks.payloadJson},
                        '$.purpose'
                    ) = 'download_thumbnail'`
                )
            )
            .run()
    }

    getStatus(mediaId: number, fileId: number): ThumbnailStatusDto | null {
        return this.db.transaction((tx): ThumbnailStatusDto | null => {
            const media = tx.select().from(s.medias).where(eq(s.medias.id, mediaId)).get()

            const file = tx
                .select()
                .from(s.mediaFiles)
                .where(and(eq(s.mediaFiles.id, fileId), eq(s.mediaFiles.mediaId, mediaId)))
                .get()

            if (!media || !file) return null

            const status: ThumbnailStatusDto = {
                state: 'unsupported',
                taskId: null,
                canRetry: false
            }

            if (
                media.sourceKind !== 'download' ||
                file.storageKind !== 'app_managed' ||
                (file.kind !== 'video' && file.kind !== 'audio') ||
                typeof file.externalId !== 'string' ||
                !/^[A-Za-z0-9_-]{11}$/.test(file.externalId) ||
                file.fileKey !== `youtube:${file.externalId}` ||
                file.hashAlgorithm !== 'sha256' ||
                typeof file.contentHash !== 'string' ||
                !/^[0-9a-f]{64}$/.test(file.contentHash)
            ) {
                return status
            }

            // DB 등록 상태만 조회한다. 파일 검사나 온라인 조회는 실행하지 않는다.
            if (file.thumbnailPath !== null) {
                return { ...status, state: 'registered' }
            }

            if (file.thumbnailOrigin !== 'none') {
                return { ...status, state: 'blocked' }
            }

            if (media.lastDownloadCommitAttemptId === null) {
                return { ...status, state: 'missing' }
            }

            const task = tx
                .select()
                .from(s.maintenanceTasks)
                .where(
                    and(
                        eq(s.maintenanceTasks.kind, 'preview_generation'),
                        eq(s.maintenanceTasks.ownerKind, 'download'),
                        eq(s.maintenanceTasks.downloadAttemptId, media.lastDownloadCommitAttemptId),
                        sql`json_extract(
                        ${s.maintenanceTasks.payloadJson}, '$.purpose'
                    ) = 'download_thumbnail'`,
                        sql`json_extract(
                        ${s.maintenanceTasks.payloadJson}, '$.mediaId'
                    ) = ${mediaId}`,
                        sql`json_extract(
                        ${s.maintenanceTasks.payloadJson}, '$.fileId'
                    ) = ${fileId}`,
                        sql`json_extract(
                        ${s.maintenanceTasks.payloadJson}, '$.contentHash'
                    ) = ${file.contentHash}`,
                        sql`json_extract(
                        ${s.maintenanceTasks.payloadJson}, '$.transformVersion'
                    ) = 'jpeg-v1'`
                    )
                )
                .orderBy(desc(s.maintenanceTasks.updatedAt), desc(s.maintenanceTasks.id))
                .get()

            if (!task) {
                return { ...status, state: 'missing' }
            }

            try {
                // 현재 파일과 작업의 소유 관계 및 고정 저장 경로를 확인한다.
                this.inspect(tx, task)
            } catch (error) {
                if (error instanceof Error && error.message === 'THUMBNAIL_SOURCE_CHANGED') {
                    return {
                        ...status,
                        state: 'blocked',
                        taskId: task.id
                    }
                }

                throw error
            }

            // 완료 작업인데 파일에 썸네일 등록이 없으면 자동으로 재생성하지 않는다.
            if (task.state === 'completed') {
                return {
                    ...status,
                    state: 'blocked',
                    taskId: task.id
                }
            }

            return {
                state: task.state,
                taskId: task.id,
                canRetry: task.state === 'failed' && task.lastError === 'THUMBNAIL_UNAVAILABLE'
            }
        })
    }

    retryFailed(taskId: string): ThumbnailRetryResult {
        return this.db.transaction((tx): ThumbnailRetryResult => {
            const task = tx
                .select()
                .from(s.maintenanceTasks)
                .where(
                    and(
                        eq(s.maintenanceTasks.id, taskId),
                        eq(s.maintenanceTasks.kind, 'preview_generation'),
                        eq(s.maintenanceTasks.ownerKind, 'download'),
                        sql`json_extract(
                        ${s.maintenanceTasks.payloadJson},
                        '$.purpose'
                    ) = 'download_thumbnail'`
                    )
                )
                .get()

            // 온라인 조회 실패만 수동 재시도 대상으로 허용한다.
            if (!task || task.state !== 'failed' || task.lastError !== 'THUMBNAIL_UNAVAILABLE') {
                return { accepted: false, reason: 'not_retryable' }
            }

            try {
                // 현재 미디어·파일·다운로드 시도가 기존 작업과 일치하는지 확인한다.
                const { work } = this.inspect(tx, task)

                // 같은 미디어를 재다운로드하는 동안에는 재시도하지 않는다.
                this.assertIdle(tx, work.mediaId)
            } catch (error) {
                const code = error instanceof Error ? error.message : ''

                if (code === 'THUMBNAIL_SOURCE_BUSY') {
                    return { accepted: false, reason: 'source_busy' }
                }

                if (code === 'THUMBNAIL_SOURCE_CHANGED') {
                    return { accepted: false, reason: 'source_changed' }
                }

                throw error
            }

            // 기존 작업 ID·저장 경로·검증 기록·시도 횟수는 유지한다.
            tx.update(s.maintenanceTasks)
                .set({
                    state: 'pending',
                    lastError: null,
                    updatedAt: Date.now()
                })
                .where(
                    and(
                        eq(s.maintenanceTasks.id, task.id),
                        eq(s.maintenanceTasks.state, 'failed'),
                        eq(s.maintenanceTasks.lastError, 'THUMBNAIL_UNAVAILABLE')
                    )
                )
                .run()

            return { accepted: true }
        })
    }

    private runningTask(tx: Tx, taskId: string): Task {
        const task = tx
            .select()
            .from(s.maintenanceTasks)
            .where(eq(s.maintenanceTasks.id, taskId))
            .get()

        if (!task || task.state !== 'running') {
            throw new Error('THUMBNAIL_TASK_NOT_RUNNING')
        }

        return task
    }

    private inspect(tx: Tx, task: Task): { work: ThumbnailWork; payload: StoredPayload } {
        const payload = JSON.parse(task.payloadJson) as StoredPayload

        if (
            task.kind !== 'preview_generation' ||
            task.ownerKind !== 'download' ||
            task.downloadAttemptId === null ||
            !payload ||
            payload.version !== 1 ||
            payload.purpose !== 'download_thumbnail' ||
            payload.transformVersion !== 'jpeg-v1' ||
            !Number.isSafeInteger(payload.mediaId) ||
            payload.mediaId <= 0 ||
            !Number.isSafeInteger(payload.fileId) ||
            payload.fileId <= 0 ||
            typeof payload.fileKey !== 'string' ||
            typeof payload.contentHash !== 'string' ||
            !/^[0-9a-f]{64}$/.test(payload.contentHash)
        ) {
            throw new Error('THUMBNAIL_TASK_INVALID')
        }

        const attempt = tx
            .select()
            .from(s.downloadAttempts)
            .where(eq(s.downloadAttempts.id, task.downloadAttemptId))
            .get()

        const media = tx.select().from(s.medias).where(eq(s.medias.id, payload.mediaId)).get()

        const file = tx.select().from(s.mediaFiles).where(eq(s.mediaFiles.id, payload.fileId)).get()

        if (
            !attempt ||
            attempt.outcome !== 'completed' ||
            attempt.committedAt === null ||
            attempt.targetMediaId !== payload.mediaId ||
            !media ||
            media.sourceKind !== 'download' ||
            media.lastDownloadCommitAttemptId !== attempt.id ||
            !file ||
            file.mediaId !== media.id ||
            file.storageKind !== 'app_managed' ||
            file.fileKey !== payload.fileKey ||
            file.contentHash !== payload.contentHash ||
            file.thumbnailPath !== null ||
            file.thumbnailOrigin !== 'none' ||
            (file.kind !== 'video' && file.kind !== 'audio') ||
            typeof file.externalId !== 'string' ||
            !/^[A-Za-z0-9_-]{11}$/.test(file.externalId) ||
            file.fileKey !== `youtube:${file.externalId}`
        ) {
            throw new Error('THUMBNAIL_SOURCE_CHANGED')
        }

        const target = tx
            .select()
            .from(s.downloadTargets)
            .where(
                and(
                    eq(s.downloadTargets.attemptId, attempt.id),
                    eq(s.downloadTargets.targetKey, file.fileKey)
                )
            )
            .get()

        if (!target || target.finalPath !== file.filepath) {
            throw new Error('THUMBNAIL_SOURCE_CHANGED')
        }

        const work: ThumbnailWork = {
            taskId: task.id,
            attemptId: attempt.id,
            storageRoot: new DownloadRootRepository(tx).get(attempt.jobId),
            mediaId: media.id,
            fileId: file.id,
            fileKey: file.fileKey,
            contentHash: payload.contentHash,
            sourceUrl: `https://www.youtube.com/watch?v=${file.externalId}`,
            transformVersion: payload.transformVersion,
            artifact: payload.artifact
        }

        if (payload.artifact) {
            validateProof(payload.artifact, downloadThumbnailPaths(work).stagedPath)
        }

        return { work, payload }
    }
}
