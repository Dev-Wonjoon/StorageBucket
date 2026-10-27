import { isDeepStrictEqual } from 'node:util'
import { and, eq, sql } from 'drizzle-orm'
import * as s from '../../../database/schema-v2'
import type { V2Database } from '@features/media/MediaRepository'
import { DownloadRepositoryError } from './DownloadRepository'

export interface DownloadWorkspaceSnapshot {
    jobId: string
    attemptId: string
    requestUrlId: number
    mode: 'create' | 'replace'
    targetMediaIdSnapshot: number | null
}

export class DownloadWorkspaceRepository {
    constructor(private db: V2Database) {
        if (db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys !== 1) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }
    }

    snapshot(jobId: string, attemptId: string): DownloadWorkspaceSnapshot {
        for (const id of [jobId, attemptId]) {
            if (typeof id !== 'string' || !id.trim() || id.includes('\0')) {
                throw new DownloadRepositoryError('INVALID_ARGUMENT')
            }
        }

        return this.db.transaction((tx) => {
            const job = tx.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, jobId)).get()

            const attempt = tx
                .select()
                .from(s.downloadAttempts)
                .where(
                    and(eq(s.downloadAttempts.id, attemptId), eq(s.downloadAttempts.jobId, jobId))
                )
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
                attempt.phase !== 'discovering' ||
                attempt.outcome !== null ||
                attempt.committedAt !== null ||
                attempt.finishedAt !== null ||
                attempt.manifestPath !== null ||
                attempt.targetMediaId !== job.targetMediaId ||
                attempt.targetMediaIdSnapshot !== job.targetMediaIdSnapshot ||
                job.targetMediaId !== job.targetMediaIdSnapshot
            ) {
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            if (attempt.cancelRequestedAt !== null) {
                throw new DownloadRepositoryError('CANCEL_REQUESTED')
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
                throw new DownloadRepositoryError('INVALID_STATE')
            }

            const conflict = tx.get<{ found: number }>(sql`
                SELECT (
                    EXISTS(
                        SELECT 1 FROM download_attempt
                        WHERE job_id = ${jobId}
                          AND id <> ${attemptId}
                          AND outcome IS NULL
                    )
                    OR EXISTS(
                        SELECT 1 FROM media
                        WHERE last_download_commit_attempt_id = ${attemptId}
                    )
                ) AS found
            `)

            if (conflict?.found) {
                throw new DownloadRepositoryError('INVARIANT_VIOLATION')
            }

            return {
                jobId,
                attemptId,
                requestUrlId: job.requestUrlId,
                mode: job.mode,
                targetMediaIdSnapshot: job.targetMediaIdSnapshot
            }
        })
    }

    assertCurrent(expected: DownloadWorkspaceSnapshot) {
        if (!isDeepStrictEqual(this.snapshot(expected.jobId, expected.attemptId), expected)) {
            throw new DownloadRepositoryError('VERIFICATION_CHANGED')
        }
    }
}
