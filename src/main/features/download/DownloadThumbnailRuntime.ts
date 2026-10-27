import type { V2Database } from '@features/media/MediaRepository'
import { DownloadThumbnailRepository } from '@features/thumbnail/DownloadThumbnailRepository'
import { DownloadThumbnailService } from '@features/thumbnail/DownloadThumbnailService'
import { getDownloadPreviews } from '../thumbnail/DownloadPreviewRuntime'

export function startDownloadThumbnailWorker(
    db: V2Database,
    onChanged: (mediaId: number) => void
): () => void {
    const repository = new DownloadThumbnailRepository(db)

    // 앱의 단일 인스턴스 잠금 획득 후 시작 단계에서 호출한다.
    repository.recoverAtStartup()

    let stopped = false
    let backfillPending = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const service = new DownloadThumbnailService(repository, getDownloadPreviews(), {
        onChanged: (mediaId) => {
            if (!stopped) onChanged(mediaId)
        }
    })

    async function tick(): Promise<void> {
        if (stopped) return

        try {
            if (backfillPending) {
                backfillPending = repository.enqueueMissing() === 100
            }

            if (!stopped) {
                await service.runPending()
            }
        } catch (error) {
            console.error('[ThumbnailWorker] 작업 처리 실패:', error)
        } finally {
            if (!stopped) {
                timer = setTimeout(() => {
                    void tick()
                }, 2000)
            }
        }
    }

    void tick()

    return () => {
        stopped = true
        service.stop()

        if (timer !== undefined) {
            clearTimeout(timer)
            timer = undefined
        }
    }
}
