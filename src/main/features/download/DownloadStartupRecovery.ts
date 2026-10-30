import { sql } from 'drizzle-orm'
import type { V2Database } from '../media/MediaRepository'
import { DownloadRepositoryError } from './DownloadRepository'
import { DownloadRootRepository } from './DownloadRootRepository'
import {
    DownloadRecoveryRepository,
    type DownloadRecoveryDecision
} from './DownloadRecoveryRepository'

// 엔진 종료를 사용자가 확인한 개발용 복구 모드에서만 호출한다.
// 파일 삭제·엔진 실행·새 다운로드 시도 생성은 하지 않는다.
export function recoverInterruptedDownloadsAtStartup(
    db: V2Database,
    enginesStoppedConfirmed: boolean
): DownloadRecoveryDecision[] {
    if (enginesStoppedConfirmed !== true) {
        throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
    }

    const jobs = db.all<{ id: string }>(sql`
        SELECT q.id
        FROM download_queue q
        WHERE q.state = 'running'
           OR EXISTS (
               SELECT 1
               FROM download_attempt a
               WHERE a.job_id = q.id
                 AND a.outcome IS NULL
           )
        ORDER BY q.id
    `)

    const roots = new DownloadRootRepository(db)
    const results: DownloadRecoveryDecision[] = []

    for (const job of jobs) {
        // 현재 설정 대신 해당 작업에 고정된 저장 경로를 사용한다.
        const recovery = new DownloadRecoveryRepository(db, roots.get(job.id))
        const result = recovery.recoverAtStartup(job.id)

        if (result.status === 'blocked' || result.status === 'uncommitted') {
            throw new DownloadRepositoryError('INVARIANT_VIOLATION', {
                reason:
                    result.status === 'blocked'
                        ? result.reason
                        : 'RECOVERY_UNFINISHED'
            })
        }

        results.push(result)
    }

    return results
}