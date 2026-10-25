import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { asc, eq, sql } from 'drizzle-orm'
import * as s from '../../database/schema-v2'
import type { V2Database } from './MediaRepository'
import { DownloadRepositoryError } from './DownloadRepository'

type Tx = Parameters<Parameters<V2Database['transaction']>[0]>[0]

export interface DownloadCleanupSnapshot {
    task: typeof s.maintenanceTasks.$inferSelect
    job: typeof s.downloadQueue.$inferSelect
    attempt: typeof s.downloadAttempts.$inferSelect
    targets: (typeof s.downloadTargets.$inferSelect)[]
    stagingDirectory: string
    finalDirectory: string
}

export class DownloadCleanupRepository {
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

    startAtStartup(taskId: string): DownloadCleanupSnapshot | null {
        if (typeof taskId !== 'string' || !taskId.trim()) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return this.write((tx, now) => {
            const task = this.task(tx, taskId)

            if (task.state === 'completed') {
                const attempt = tx
                    .select()
                    .from(s.downloadAttempts)
                    .where(eq(s.downloadAttempts.id, task.downloadAttemptId!))
                    .get()

                const job = attempt
                    ? tx
                          .select()
                          .from(s.downloadQueue)
                          .where(eq(s.downloadQueue.id, attempt.jobId))
                          .get()
                    : undefined

                if (job?.currentAttemptId === attempt?.id && job?.cleanupRequired) {
                    throw new DownloadRepositoryError('CLEANUP_REQUIRED')
                }

                return null
            }

            const snapshot = this.load(tx, taskId)

            if (!Number.isSafeInteger(task.tryCount + 1)) {
                throw new DownloadRepositoryError('INVARIANT_VIOLATION')
            }

            tx.update(s.maintenanceTasks)
                .set({
                    state: 'running',
                    tryCount: task.tryCount + 1,
                    lastError: null,
                    updatedAt: now
                })
                .where(eq(s.maintenanceTasks.id, taskId))
                .run()

            return this.load(tx, snapshot.task.id)
        })
    }

    references(snapshot: DownloadCleanupSnapshot): string[] {
        return this.db.transaction((tx) => {
            this.match(tx, snapshot)

            return tx
                .all<{ path: string }>(
                    sql`
                    SELECT filepath AS path FROM media_file
                    UNION
                    SELECT thumbnail_path FROM media_file
                    WHERE thumbnail_path IS NOT NULL
                    UNION
                    SELECT preview_path FROM media_file
                    WHERE preview_path IS NOT NULL
                    ORDER BY path
                `
                )
                .map((row) => row.path)
        })
    }

    finish(snapshot: DownloadCleanupSnapshot) {
        this.write((tx, now) => {
            this.match(tx, snapshot)

            tx.update(s.maintenanceTasks)
                .set({
                    state: 'completed',
                    lastError: null,
                    updatedAt: now
                })
                .where(eq(s.maintenanceTasks.id, snapshot.task.id))
                .run()

            tx.update(s.downloadQueue)
                .set({
                    cleanupRequired: false,
                    updatedAt: now
                })
                .where(eq(s.downloadQueue.id, snapshot.job.id))
                .run()
        })
    }

    fail(snapshot: DownloadCleanupSnapshot, code: string) {
        this.write((tx, now) => {
            this.match(tx, snapshot)

            tx.update(s.maintenanceTasks)
                .set({
                    state: 'failed',
                    lastError: code,
                    updatedAt: now
                })
                .where(eq(s.maintenanceTasks.id, snapshot.task.id))
                .run()
        })
    }

    private task(tx: Tx, id: string) {
        const task = tx.select().from(s.maintenanceTasks).where(eq(s.maintenanceTasks.id, id)).get()

        if (!task) {
            throw new DownloadRepositoryError('NOT_FOUND')
        }

        if (
            task.kind !== 'rollback_cleanup' ||
            task.ownerKind !== 'download' ||
            task.downloadAttemptId === null
        ) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        return task
    }

    private load(tx: Tx, id: string): DownloadCleanupSnapshot {
        const task = this.task(tx, id)

        const attempt = tx
            .select()
            .from(s.downloadAttempts)
            .where(eq(s.downloadAttempts.id, task.downloadAttemptId!))
            .get()

        const job = attempt
            ? tx.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, attempt.jobId)).get()
            : undefined

        if (
            !attempt ||
            !job ||
            task.state === 'completed' ||
            !job.cleanupRequired ||
            job.currentAttemptId !== attempt.id ||
            attempt.committedAt !== null ||
            attempt.phase !== 'finished' ||
            !['failed', 'cancelled', 'interrupted'].includes(attempt.outcome ?? '') ||
            attempt.finishedAt === null ||
            job.state !== attempt.outcome ||
            attempt.targetMediaId !== job.targetMediaId ||
            attempt.targetMediaIdSnapshot !== job.targetMediaIdSnapshot
        ) {
            throw new DownloadRepositoryError('CLEANUP_REQUIRED')
        }

        const unsafe = tx.get<{ found: number }>(sql`
            SELECT (
                EXISTS(
                    SELECT 1 FROM media
                    WHERE last_download_commit_attempt_id = ${attempt.id}
                )
                OR EXISTS(
                    SELECT 1 FROM download_attempt
                    WHERE job_id = ${job.id}
                      AND outcome IS NULL
                )
                OR (
                    SELECT count(*) FROM maintenance_task
                    WHERE kind = 'rollback_cleanup'
                      AND owner_kind = 'download'
                      AND download_attempt_id = ${attempt.id}
                ) <> 1
            ) AS found
        `)

        if (unsafe?.found) {
            throw new DownloadRepositoryError('CLEANUP_REQUIRED')
        }

        const owner = createHash('sha256')
            .update(JSON.stringify([job.id, attempt.id]))
            .digest('hex')

        const base = join(this.root, '.storagebucket')

        const expected = {
            version: 1,
            jobId: job.id,
            attemptId: attempt.id,
            stagingDirectory: join(base, 'staging', owner),
            finalDirectory: join(base, 'files', owner),
            manifestPath: join(base, 'manifests', owner + '.json')
        }

        if (
            !isDeepStrictEqual(JSON.parse(task.payloadJson), expected) ||
            (attempt.manifestPath !== null && attempt.manifestPath !== expected.manifestPath)
        ) {
            throw new DownloadRepositoryError('VERIFICATION_CHANGED')
        }

        const targets = tx
            .select()
            .from(s.downloadTargets)
            .where(eq(s.downloadTargets.attemptId, attempt.id))
            .orderBy(asc(s.downloadTargets.position), asc(s.downloadTargets.id))
            .all()

        return {
            task,
            job,
            attempt,
            targets,
            stagingDirectory: expected.stagingDirectory,
            finalDirectory: expected.finalDirectory
        }
    }

    private match(tx: Tx, snapshot: DownloadCleanupSnapshot) {
        if (!isDeepStrictEqual(this.load(tx, snapshot.task.id), snapshot)) {
            throw new DownloadRepositoryError('VERIFICATION_CHANGED')
        }
    }

    private write<T>(action: (tx: Tx, now: number) => T): T {
        return this.db.transaction(
            (tx) => {
                const now = this.clock()

                if (!Number.isSafeInteger(now) || now < 0) {
                    throw new DownloadRepositoryError('INVARIANT_VIOLATION')
                }

                return action(tx, now)
            },
            { behavior: 'immediate' }
        )
    }
}
