import { useToast } from '@renderer/components/ui/Toast'
import { useState, useEffect, useMemo, useRef } from 'react'
import { DownloadJob } from 'src/shared/types'

interface DownloadViewModel {
    queue: DownloadJob[]
    isPanelOpen: boolean
    activeCount: number
    totalProgress: number
    isDownloading: boolean
    startDownload: (url: string) => Promise<void>
    togglePanel: () => void
}

export const useDownloadViewModel = (): DownloadViewModel => {
    const [queue, setQueue] = useState<DownloadJob[]>([])
    const [isPanelOpen, setIsPanelOpen] = useState(false)
    const { showToast } = useToast()

    const prevQueueRef = useRef<DownloadJob[]>([])

    const activeItems = useMemo(
        () => queue.filter((j) => j.status === 'downloading' || j.status === 'pending'),
        [queue]
    )

    const activeCount = activeItems.length
    const isDownloading = activeCount > 0

    const totalProgress = useMemo(() => {
        if (activeCount === 0) return 0
        const sum = activeItems.reduce((acc, current) => acc + (current.progress || 0), 0)
        return sum / activeCount
    }, [activeItems, activeCount])

    useEffect(() => {
        if (!window.api?.onQueueUpdate) return

        const removeListener = window.api.onQueueUpdate((updatedQueue: DownloadJob[]) => {
            const prevQueue = prevQueueRef.current

            const hasNewlyCompleted = updatedQueue.some(
                (job) =>
                    job.status === 'completed' &&
                    prevQueue.find((prev) => prev.id === job.id)?.status !== 'completed'
            )

            setQueue(updatedQueue)
            prevQueueRef.current = updatedQueue

            if (hasNewlyCompleted) {
                console.log('[DownloadViewModel] Download completed → refreshing gallery')
                window.dispatchEvent(new CustomEvent('gallery-refresh'))
            }

            const hasActiveJobs = updatedQueue.some(
                (job) => job.status === 'downloading' || job.status === 'pending'
            )

            if (hasActiveJobs) {
                setIsPanelOpen(true)
            }
        })
        const removeDupListener = window.api.onDuplicate?.(
            (data: { jobId: string; message: string }) => {
                showToast(data.message)
            }
        )

        return () => {
            removeListener()
            removeDupListener?.()
        }
    }, [showToast])

    const startDownload = async (url: string): Promise<void> => {
        console.log('[ViewModel] Requesting download:', url)

        try {
            if (!window.api?.downloadVideo) {
                console.error('[Renderer] window.api is undefined.')
                return
            }
            const result = await window.api.downloadVideo(url)

            if (!result.success) {
                console.error('Download Request Failed:', result.error || result.message)
                showToast(result.message || '다운로드 요청에 실패했습니다.')
            } else if (result.message) {
                showToast(result.message)
            }
        } catch (error) {
            console.error('IPC Error:', error)
            showToast('통신 중 오류가 발생했습니다.')
        }
    }

    const togglePanel = (): void => setIsPanelOpen((prev) => !prev)

    return {
        queue,
        isPanelOpen,
        activeCount,
        totalProgress,
        isDownloading,
        startDownload,
        togglePanel
    }
}
