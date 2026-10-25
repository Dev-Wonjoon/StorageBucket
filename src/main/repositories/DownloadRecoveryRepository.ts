import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { and, eq, isNull, sql } from 'drizzle-orm'
import * as s from '../../database/schema-v2'
import type { V2Database } from './MediaRepository'
import { DownloadRepositoryError } from './DownloadRepository'

type Tx = Parameters<Parameters<V2Database['transaction']>[0]>[0]

export type DownloadRecoveryReason =
    | 'DATABASE_UNAVAILABLE'
    | 'INCONSISTENT_STATE'
    | 'UNFINISHED_HISTORY'
    | 'COMMIT_MARKER_CONFLICT'
    | 'MANIFEST_PATH_MISMATCH'
    | 'MISSING_CLEANUP_TASK'
    | 'ENGINE_STATE_UNKNOWN'

export type DownloadRecoveryDecision =
    | {
          status: 'idle' | 'settled'
          jobId: string
      }
    | {
          status: 'committed'
          jobId: string
          attemptId: string
          mediaIdSnapshot: number
      }
    | {
          status: 'uncommitted'
          jobId: string
          attemptId: string
          outcome: 'interrupted' | 'cancelled'
      }
    | {
          status: 'cleanup_required'
          jobId: string
          attemptId: string
          taskId: string
      }
    | {
          status: 'blocked'
          jobId: string
          reason: DownloadRecoveryReason
      }

export class DownloadRecoveryRepository {
    private readonly root: string

    constructor(
        private db: V2Database,
        storageRoot: string,
        private clock: () => number = Date.now
    ) {
        if (!isAbsolute(storageRoot) || storageRoot.includes('\0')) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        this.root = resolve(storageRoot)

        if (db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys !== 1) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }
    }

    inspect(jobId: string): DownloadRecoveryDecision {
        this.id(jobId)

        return this.guard(jobId, () => this.db.transaction((tx) => this.classify(tx, jobId)))
    }

    // 시작 시 외부 프로세스와 작업 실행이 멈춘 상태에서만 호출한다.
    // 파일 삭제·네트워크 요청·새 attempt 생성은 하지 않는다.
    // 시작 시 외부 프로세스와 작업 실행이 멈춘 상태에서만 호출한다.
    recoverAtStartup(jobId: string): DownloadRecoveryDecision {
        return this.finishUncommitted(jobId, undefined, 'APP_INTERRUPTED')
    }

    // 어댑터의 Promise가 자식 프로세스 종료까지 기다린 뒤에만 호출한다.
    finishAfterEngineExit(
        jobId: string,
        attemptId: string,
        errorCode: string
    ): DownloadRecoveryDecision {
        this.id(attemptId)

        if (typeof errorCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(errorCode)) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return this.finishUncommitted(jobId, attemptId, errorCode)
    }

    private finishUncommitted(
        jobId: string,
        expectedAttemptId: string | undefined,
        errorCode: string
    ): DownloadRecoveryDecision {
        this.id(jobId)

        return this.guard(jobId, () =>
            this.db.transaction(
                (tx): DownloadRecoveryDecision => {
                    const decision = this.classify(tx, jobId)

                    if (
                        expectedAttemptId !== undefined &&
                        decision.status !== 'blocked' &&
                        (!('attemptId' in decision) || decision.attemptId !== expectedAttemptId)
                    ) {
                        return {
                            status: 'blocked',
                            jobId,
                            reason: 'INCONSISTENT_STATE'
                        }
                    }

                    if (decision.status !== 'uncommitted') {
                        return decision
                    }

                    const now = this.clock()

                    if (!Number.isSafeInteger(now) || now < 0) {
                        throw new DownloadRepositoryError('INVARIANT_VIOLATION')
                    }

                    const outcome =
                        decision.outcome === 'cancelled'
                            ? 'cancelled'
                            : expectedAttemptId === undefined
                              ? 'interrupted'
                              : 'failed'

                    const taskId = randomUUID()

                    tx.update(s.downloadAttempts)
                        .set({
                            phase: 'finished',
                            outcome,
                            finishedAt: now
                        })
                        .where(eq(s.downloadAttempts.id, decision.attemptId))
                        .run()

                    tx.update(s.downloadQueue)
                        .set({
                            state: outcome,
                            cleanupRequired: true,
                            errorCode: outcome === 'cancelled' ? 'CANCEL_REQUESTED' : errorCode,
                            errorMessage: null,
                            finishedAt: now,
                            updatedAt: now
                        })
                        .where(eq(s.downloadQueue.id, jobId))
                        .run()

                    tx.insert(s.maintenanceTasks)
                        .values({
                            id: taskId,
                            kind: 'rollback_cleanup',
                            state: 'pending',
                            ownerKind: 'download',
                            downloadAttemptId: decision.attemptId,
                            payloadJson: JSON.stringify({
                                version: 1,
                                jobId,
                                attemptId: decision.attemptId,
                                ...this.paths(jobId, decision.attemptId)
                            }),
                            createdAt: now,
                            updatedAt: now
                        })
                        .run()

                    return {
                        status: 'cleanup_required',
                        jobId,
                        attemptId: decision.attemptId,
                        taskId
                    }
                },
                { behavior: 'immediate' }
            )
        )
    }

    private classify(tx: Tx, jobId: string): DownloadRecoveryDecision {
        const blocked = (reason: DownloadRecoveryReason): DownloadRecoveryDecision => ({
            status: 'blocked',
            jobId,
            reason
        })

        const job = tx.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, jobId)).get()

        if (!job) {
            throw new DownloadRepositoryError('NOT_FOUND')
        }

        const unfinished = tx
            .select({ id: s.downloadAttempts.id })
            .from(s.downloadAttempts)
            .where(and(eq(s.downloadAttempts.jobId, jobId), isNull(s.downloadAttempts.outcome)))
            .limit(2)
            .all()

        if (job.currentAttemptId === null) {
            const history = tx
                .select({ id: s.downloadAttempts.id })
                .from(s.downloadAttempts)
                .where(eq(s.downloadAttempts.jobId, jobId))
                .limit(1)
                .get()

            if (unfinished.length || history || job.cleanupRequired || job.state === 'running') {
                return blocked('INCONSISTENT_STATE')
            }

            // 이관된 기존 완료/중단 큐는 v2 attempt가 없어도 재실행하지 않는다.
            return {
                status: job.state === 'pending' ? 'idle' : 'settled',
                jobId
            }
        }

        const attempt = tx
            .select()
            .from(s.downloadAttempts)
            .where(
                and(
                    eq(s.downloadAttempts.id, job.currentAttemptId),
                    eq(s.downloadAttempts.jobId, jobId)
                )
            )
            .get()

        if (
            !attempt ||
            attempt.targetMediaId !== job.targetMediaId ||
            attempt.targetMediaIdSnapshot !== job.targetMediaIdSnapshot
        ) {
            return blocked('INCONSISTENT_STATE')
        }

        if (unfinished.some((row) => row.id !== attempt.id) || unfinished.length > 1) {
            return blocked('UNFINISHED_HISTORY')
        }

        if (
            attempt.manifestPath !== null &&
            attempt.manifestPath !== this.paths(jobId, attempt.id).manifestPath
        ) {
            return blocked('MANIFEST_PATH_MISMATCH')
        }

        const marker = tx
            .select({ id: s.medias.id })
            .from(s.medias)
            .where(eq(s.medias.lastDownloadCommitAttemptId, attempt.id))
            .get()

        const cleanup = tx
            .select()
            .from(s.maintenanceTasks)
            .where(
                and(
                    eq(s.maintenanceTasks.kind, 'rollback_cleanup'),
                    eq(s.maintenanceTasks.ownerKind, 'download'),
                    eq(s.maintenanceTasks.downloadAttemptId, attempt.id)
                )
            )
            .limit(2)
            .all()

        if (attempt.committedAt !== null || attempt.outcome === 'completed') {
            if (
                attempt.committedAt === null ||
                attempt.outcome !== 'completed' ||
                attempt.phase !== 'finished' ||
                attempt.finishedAt === null ||
                job.state !== 'completed' ||
                job.progress !== 100 ||
                job.cleanupRequired ||
                cleanup.length ||
                unfinished.length ||
                attempt.targetMediaIdSnapshot === null
            ) {
                return blocked('INCONSISTENT_STATE')
            }

            if (attempt.targetMediaId !== null) {
                const parent = tx
                    .select()
                    .from(s.medias)
                    .where(eq(s.medias.id, attempt.targetMediaId))
                    .get()

                if (
                    !parent ||
                    parent.sourceKind !== 'download' ||
                    parent.requestUrlId !== job.requestUrlId
                ) {
                    return blocked('COMMIT_MARKER_CONFLICT')
                }

                if (parent.lastDownloadCommitAttemptId !== attempt.id) {
                    // 이후 재다운로드로 마지막 커밋 ID가 바뀌어도 과거 성공은 유지한다.
                    const latest =
                        parent.lastDownloadCommitAttemptId === null
                            ? undefined
                            : tx
                                  .select()
                                  .from(s.downloadAttempts)
                                  .where(
                                      eq(s.downloadAttempts.id, parent.lastDownloadCommitAttemptId)
                                  )
                                  .get()

                    const owner = latest
                        ? tx
                              .select()
                              .from(s.downloadQueue)
                              .where(eq(s.downloadQueue.id, latest.jobId))
                              .get()
                        : undefined

                    if (
                        !latest ||
                        latest.targetMediaId !== parent.id ||
                        latest.outcome !== 'completed' ||
                        latest.committedAt === null ||
                        latest.phase !== 'finished' ||
                        latest.finishedAt === null ||
                        owner?.requestUrlId !== job.requestUrlId ||
                        owner.state !== 'completed' ||
                        owner.currentAttemptId !== latest.id ||
                        owner.targetMediaId !== parent.id
                    ) {
                        return blocked('COMMIT_MARKER_CONFLICT')
                    }
                }
            } else if (marker) {
                return blocked('COMMIT_MARKER_CONFLICT')
            }

            return {
                status: 'committed',
                jobId,
                attemptId: attempt.id,
                mediaIdSnapshot: attempt.targetMediaIdSnapshot
            }
        }

        if (marker) {
            return blocked('COMMIT_MARKER_CONFLICT')
        }

        if (attempt.outcome !== null) {
            if (
                attempt.phase !== 'finished' ||
                attempt.finishedAt === null ||
                job.state !== attempt.outcome ||
                unfinished.length
            ) {
                return blocked('INCONSISTENT_STATE')
            }

            if (job.cleanupRequired) {
                if (cleanup.length !== 1 || cleanup[0].state === 'completed') {
                    return blocked('MISSING_CLEANUP_TASK')
                }

                return {
                    status: 'cleanup_required',
                    jobId,
                    attemptId: attempt.id,
                    taskId: cleanup[0].id
                }
            }

            return cleanup.some((task) => task.state !== 'completed')
                ? blocked('INCONSISTENT_STATE')
                : {
                      status: 'settled',
                      jobId
                  }
        }

        if (
            job.state !== 'running' ||
            job.cleanupRequired ||
            cleanup.length ||
            attempt.phase === 'finished' ||
            unfinished.length !== 1
        ) {
            return blocked('INCONSISTENT_STATE')
        }

        const parent = tx
            .select()
            .from(s.medias)
            .where(eq(s.medias.requestUrlId, job.requestUrlId))
            .get()

        if (
            job.mode === 'create'
                ? parent !== undefined || job.targetMediaId !== null
                : !parent || parent.id !== job.targetMediaId || parent.sourceKind !== 'download'
        ) {
            return blocked('INCONSISTENT_STATE')
        }

        const collation = process.platform === 'win32' ? sql`COLLATE NOCASE` : sql``

        const referenced = tx.get<{ found: number }>(sql`
            SELECT EXISTS (
                SELECT 1
                FROM download_target t
                JOIN media_file f
                ON f.filepath ${collation}
                    IN (t.staged_path, t.final_path)
                OR f.thumbnail_path ${collation}
                    IN (t.staged_path, t.final_path)
                OR f.preview_path ${collation}
                    IN (t.staged_path, t.final_path)
                WHERE t.attempt_id = ${attempt.id}
            ) AS found
        `)

        if (referenced?.found) {
            return blocked('COMMIT_MARKER_CONFLICT')
        }

        return {
            status: 'uncommitted',
            jobId,
            attemptId: attempt.id,
            outcome: attempt.cancelRequestedAt !== null ? 'cancelled' : 'interrupted'
        }
    }

    private paths(jobId: string, attemptId: string) {
        const owner = createHash('sha256')
            .update(JSON.stringify([jobId, attemptId]))
            .digest('hex')

        const base = join(this.root, '.storagebucket')

        return {
            stagingDirectory: join(base, 'staging', owner),
            finalDirectory: join(base, 'files', owner),
            manifestPath: join(base, 'manifests', owner + '.json')
        }
    }

    private guard(jobId: string, action: () => DownloadRecoveryDecision): DownloadRecoveryDecision {
        try {
            return action()
        } catch (error) {
            if (error instanceof DownloadRepositoryError) {
                throw error
            }

            // DB 접근 불가나 트랜잭션 결과 불명일 때 삭제·재실행을 허용하지 않는다.
            return {
                status: 'blocked',
                jobId,
                reason: 'DATABASE_UNAVAILABLE'
            }
        }
    }

    private id(value: string) {
        if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }
    }
}
