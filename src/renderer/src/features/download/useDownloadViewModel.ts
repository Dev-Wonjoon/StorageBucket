import { useCallback, useContext, useSyncExternalStore } from 'react'
import { useToast } from '@renderer/shared/hooks/useToast'
import type { ManualDownloadTrigger } from '../../../../shared/download-api'
import { DownloadContext } from './downloadContext'

export function useDownloadViewModel() {
    const store = useContext(DownloadContext)

    if (!store) {
        throw new Error('useDownloadViewModel must be used within DownloadProvider')
    }

    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    const { showToast } = useToast()

    const startDownload = useCallback(
        async (url: string): Promise<boolean> => {
            const result = await store.startDownload(url)

            if (!result.ok) {
                showToast(result.error.message, 'error')
                return false
            }

            showToast('다운로드 대기열에 등록했습니다.', 'info')

            return true
        },
        [store, showToast]
    )

    const runJob = useCallback(
        (jobId: string, trigger: ManualDownloadTrigger) => {
            void store.runJob(jobId, trigger)
        },
        [store]
    )

    const cancelDownload = useCallback(
        (jobId: string) => {
            void store.cancelDownload(jobId)
        },
        [store]
    )

    return {
        ...snapshot,
        startDownload,
        runJob,
        cancelDownload,
        refresh: store.refresh
    }
}
