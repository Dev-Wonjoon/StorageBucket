import { isAbsolute, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { V2Database } from '@features/media/MediaRepository'
import { DownloadRepositoryError } from './DownloadRepository'

type Store = Pick<V2Database, 'run' | 'get'>

export class DownloadRootRepository {
    constructor(private readonly db: Store) {
        if (db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys !== 1) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }
    }

    // 작업 생성과 같은 DB 트랜잭션 안에서 호출한다.
    bind(jobId: string, root: string): string {
        this.id(jobId)

        if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0')) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        const normalized = resolve(root)

        this.db.run(sql`
            INSERT INTO download_job_storage(
                job_id,
                storage_root,
                created_at
            )
            VALUES (${jobId}, ${normalized}, ${Date.now()})
            ON CONFLICT(job_id) DO NOTHING
        `)

        const stored = this.get(jobId)

        if (stored !== normalized) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }

        return stored
    }

    get(jobId: string): string {
        this.id(jobId)

        const row = this.db.get<{
            storageRoot: string | null
        }>(sql`
            SELECT s.storage_root AS storageRoot
            FROM download_queue q
            LEFT JOIN download_job_storage s ON s.job_id = q.id
            WHERE q.id = ${jobId}
        `)

        if (!row) {
            throw new DownloadRepositoryError('NOT_FOUND')
        }

        if (
            row.storageRoot === null ||
            !isAbsolute(row.storageRoot) ||
            row.storageRoot.includes('\0') ||
            resolve(row.storageRoot) !== row.storageRoot
        ) {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION')
        }

        return row.storageRoot
    }

    private id(value: string): void {
        if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }
    }
}
