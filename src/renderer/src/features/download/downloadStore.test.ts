import { describe, expect, it, vi, type Mock } from 'vitest'
import { createDownloadStore } from './downloadStore'
import type { DownloadJob } from '../../../../shared/types'
import type { DuplicateNotice } from '../../../../shared/api'

type QueueListener = (jobs: DownloadJob[]) => void
type DuplicateListener = (notice: DuplicateNotice) => void
interface DownloadFixture {
    api: {
        onQueueUpdate: Mock<(listener: QueueListener) => () => void>
        onDuplicate: Mock<(listener: DuplicateListener) => () => void>
        downloadVideo: Mock<() => Promise<{ success: boolean }>>
    }
    queues: Set<QueueListener>
    duplicates: Set<DuplicateListener>
    removeQueue: Mock<() => void>
    removeDuplicate: Mock<() => void>
    emit(jobs: DownloadJob[]): void
}
function createFixture(): DownloadFixture {
    const queues = new Set<(jobs: DownloadJob[]) => void>()
    const duplicates = new Set<(notice: DuplicateNotice) => void>()
    const removeQueue = vi.fn<() => void>()
    const removeDuplicate = vi.fn<() => void>()
    const api = {
        onQueueUpdate: vi.fn((listener: (jobs: DownloadJob[]) => void) => {
            queues.add(listener)
            return () => {
                queues.delete(listener)
                removeQueue()
            }
        }),
        onDuplicate: vi.fn((listener: (notice: DuplicateNotice) => void) => {
            duplicates.add(listener)
            return () => {
                duplicates.delete(listener)
                removeDuplicate()
            }
        }),
        downloadVideo: vi.fn(async () => ({ success: true }))
    }
    return {
        api,
        queues,
        duplicates,
        removeQueue,
        removeDuplicate,
        emit: (jobs: DownloadJob[]): void => queues.forEach((listener) => listener(jobs))
    }
}

function job(status: DownloadJob['status']): DownloadJob {
    return { id: 'job-1', url: 'https://example.com/video', options: {}, status, progress: 0 }
}

describe('shared download store', () => {
    it('shares one IPC subscription across renderer consumers', () => {
        const fixture = createFixture()
        const store = createDownloadStore(fixture.api)
        const stop = store.connect(vi.fn())
        const first = vi.fn()
        const second = vi.fn()
        const release = store.subscribe(first)
        store.subscribe(second)
        fixture.emit([job('downloading')])
        expect(fixture.api.onQueueUpdate).toHaveBeenCalledTimes(1)
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
        release()
        fixture.emit([job('completed')])
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(2)
        stop()
    })

    it('releases listeners once and supports StrictMode reconnects', () => {
        const fixture = createFixture()
        const store = createDownloadStore(fixture.api)
        const notice = vi.fn()
        const stop = store.connect(notice)
        stop()
        stop()
        expect(fixture.removeQueue).toHaveBeenCalledTimes(1)
        expect(fixture.removeDuplicate).toHaveBeenCalledTimes(1)
        expect(fixture.queues.size).toBe(0)
        const stopAgain = store.connect(notice)
        fixture.duplicates.forEach((listener) => listener({ jobId: 'job-1', message: '중복' }))
        expect(notice).toHaveBeenCalledTimes(1)
        expect(fixture.queues.size).toBe(1)
        stopAgain()
    })

    it('invalidates media once per newly completed queue update', () => {
        const fixture = createFixture()
        const store = createDownloadStore(fixture.api)
        const stop = store.connect(vi.fn())
        fixture.emit([job('downloading')])
        expect(store.getSnapshot().mediaRevision).toBe(0)
        fixture.emit([job('completed')])
        fixture.emit([job('completed')])
        expect(store.getSnapshot().mediaRevision).toBe(1)
        stop()
    })

    it('does not treat failed downloads as media changes', () => {
        const fixture = createFixture()
        const store = createDownloadStore(fixture.api)
        const stop = store.connect(vi.fn())
        fixture.emit([job('failed')])
        expect(store.getSnapshot().mediaRevision).toBe(0)
        stop()
    })

    it('keeps previous states when the source mutates its queue objects', () => {
        const fixture = createFixture()
        const store = createDownloadStore(fixture.api)
        const stop = store.connect(vi.fn())
        const item = job('downloading')
        fixture.emit([item])
        const previous = store.getSnapshot()
        item.status = 'completed'
        fixture.emit([item])
        expect(previous.queue[0].status).toBe('downloading')
        expect(store.getSnapshot().mediaRevision).toBe(1)
        stop()
    })

    it('cleans up the first listener if the second subscription fails', () => {
        const fixture = createFixture()
        fixture.api.onDuplicate.mockImplementationOnce(() => {
            throw new Error('bridge unavailable')
        })
        const store = createDownloadStore(fixture.api)
        expect(() => store.connect(vi.fn())).toThrow('bridge unavailable')
        expect(fixture.queues.size).toBe(0)
        const stop = store.connect(vi.fn())
        stop()
    })
})
