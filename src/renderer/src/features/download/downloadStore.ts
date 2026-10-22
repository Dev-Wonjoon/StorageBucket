import type { AppApi, DuplicateNotice, Unsubscribe } from '../../../../shared/api'
import type { DownloadJob } from '../../../../shared/types'

type DownloadApi = Pick<AppApi, 'onQueueUpdate' | 'onDuplicate' | 'downloadVideo'>
export interface DownloadSnapshot {
    queue: DownloadJob[]
    mediaRevision: number
}

export interface DownloadStore {
    getSnapshot(): DownloadSnapshot
    subscribe(listener: () => void): Unsubscribe
    connect(onDuplicate: (notice: DuplicateNotice) => void): Unsubscribe
    startDownload(url: string): ReturnType<AppApi['downloadVideo']>
}

export function createDownloadStore(api: DownloadApi): DownloadStore {
    let snapshot: DownloadSnapshot = { queue: [], mediaRevision: 0 }
    const listeners = new Set<() => void>()
    let disconnect: Unsubscribe | undefined

    return {
        getSnapshot: (): DownloadSnapshot => snapshot,
        subscribe(listener: () => void): Unsubscribe {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        connect(onDuplicate: (notice: DuplicateNotice) => void): Unsubscribe {
            // Only the app provider owns the IPC subscription.
            if (disconnect) throw new Error('Download store is already connected')
            const removeQueueListener = api.onQueueUpdate((queue) => {
                const previousStates = new Map(snapshot.queue.map((job) => [job.id, job.status]))
                const completed = queue.some(
                    (job) =>
                        job.status === 'completed' && previousStates.get(job.id) !== 'completed'
                )
                snapshot = {
                    queue: queue.map((job) => ({ ...job, options: { ...job.options } })),
                    mediaRevision: snapshot.mediaRevision + (completed ? 1 : 0)
                }
                listeners.forEach((listener) => listener())
            })
            let removeDuplicateListener: Unsubscribe
            try {
                removeDuplicateListener = api.onDuplicate(onDuplicate)
            } catch (error) {
                removeQueueListener()
                throw error
            }
            const stop = (): void => {
                if (disconnect !== stop) return
                disconnect = undefined
                removeQueueListener()
                removeDuplicateListener()
            }
            disconnect = stop
            return stop
        },
        startDownload: (url: string) => api.downloadVideo(url)
    }
}
