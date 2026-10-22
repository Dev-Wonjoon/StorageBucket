import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import { useToast } from '@renderer/shared/hooks/useToast'
import { DownloadContext } from './downloadContext'

interface DownloadViewModel {
    queue: import('../../../../shared/types').DownloadJob[]
    mediaRevision: number
    startDownload(url: string): Promise<boolean>
    activeCount: number
    isDownloading: boolean
    totalProgress: number
}

export function useDownloadViewModel(): DownloadViewModel {
    const store = useContext(DownloadContext)
    if (!store) throw new Error('useDownloadViewModel must be used within DownloadProvider')
    const { queue, mediaRevision } = useSyncExternalStore(store.subscribe, store.getSnapshot)
    const { showToast } = useToast()
    const activeItems = useMemo(
        () => queue.filter((job) => job.status === 'pending' || job.status === 'downloading'),
        [queue]
    )
    const startDownload = useCallback(
        async (url: string): Promise<boolean> => {
            try {
                const result = await store.startDownload(url.trim())
                if (!result.success) {
                    showToast(
                        result.message || result.error || '다운로드 요청에 실패했습니다.',
                        'error'
                    )
                    return false
                }
                if (result.message) showToast(result.message)
                return true
            } catch (error) {
                console.error('[Download] Request failed:', error)
                showToast('통신 중 오류가 발생했습니다.', 'error')
                return false
            }
        },
        [store, showToast]
    )
    return {
        queue,
        mediaRevision,
        startDownload,
        activeCount: activeItems.length,
        isDownloading: activeItems.length > 0,
        totalProgress: activeItems.length
            ? activeItems.reduce((sum, job) => sum + (job.progress ?? 0), 0) / activeItems.length
            : 0
    }
}
