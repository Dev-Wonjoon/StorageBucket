import type { Unsubscribe } from '../../../../shared/api'
import type {
    DownloadApi,
    DownloadJobDto,
    DownloadResponse,
    ManualDownloadTrigger
} from '../../../../shared/download-api'

export const DOWNLOAD_PAGE_SIZE = 50

type DownloadError = Extract<DownloadResponse<never>, { ok: false }>['error']

export interface DownloadNotice {
    message: string
    type: 'success' | 'error' | 'info'
}

export interface DownloadSnapshot {
    queue: DownloadJobDto[]
    mediaRevision: number
    ready: boolean
    loading: boolean
    error: DownloadError | null
    halted: string | null
    offset: number
    hasNextPage: boolean
    requestedIds: string[]
    cancellingIds: string[]
    detail: {
        jobId: string | null
        data: DownloadJobDto | null
        loading: boolean
        error: DownloadError | null
    }
}

export interface DownloadStore {
    getSnapshot(): DownloadSnapshot
    subscribe(listener: () => void): Unsubscribe
    connect(notify: (notice: DownloadNotice) => void): Unsubscribe
    refresh(offset?: number): Promise<void>
    startDownload(url: string): Promise<DownloadResponse<DownloadJobDto>>
    runJob(jobId: string, trigger: ManualDownloadTrigger): Promise<void>
    cancelDownload(jobId: string): Promise<void>
    openDetail(jobId: string): Promise<void>
    closeDetail(): void
}

function failure(code: string, message: string): DownloadResponse<never> {
    return {
        ok: false,
        error: { code, message, context: {} }
    }
}

export function createDownloadStore(api: DownloadApi, pollMs = 2000): DownloadStore {
    let snapshot: DownloadSnapshot = {
        queue: [],
        mediaRevision: 0,
        ready: false,
        loading: false,
        error: null,
        halted: null,
        offset: 0,
        hasNextPage: false,
        requestedIds: [],
        cancellingIds: [],
        detail: { jobId: null, data: null, loading: false, error: null }
    }

    const listeners = new Set<() => void>()
    const requested = new Set<string>()
    const cancelling = new Set<string>()
    const completed = new Set<string>()

    const observed = new Map<
        string,
        {
            state: DownloadJobDto['state']
            attemptId: string | null
        }
    >()

    let connected = false
    let generation = 0
    let readSerial = 0
    let detailSerial = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let notify: ((notice: DownloadNotice) => void) | undefined

    function publish(change: Partial<DownloadSnapshot>) {
        snapshot = { ...snapshot, ...change }

        for (const listener of listeners) {
            try {
                listener()
            } catch {
                // 다른 구독자에게 계속 전달한다.
            }
        }
    }

    function notice(message: string, type: DownloadNotice['type']) {
        if (!connected) return

        try {
            notify?.({ message, type })
        } catch {
            // 알림 실패는 작업 결과를 바꾸지 않는다.
        }
    }

    function commit(jobId: string, attemptId: string) {
        const key = JSON.stringify([jobId, attemptId])

        if (completed.has(key)) return

        completed.add(key)

        if (completed.size > 2000) {
            completed.delete(completed.values().next().value!)
        }

        publish({
            mediaRevision: snapshot.mediaRevision + 1
        })
    }

    function observe(job: DownloadJobDto) {
        const previous = observed.get(job.id)

        if (job.state === 'completed' && job.currentAttemptId) {
            if (
                previous &&
                (previous.state !== 'completed' || previous.attemptId !== job.currentAttemptId)
            ) {
                commit(job.id, job.currentAttemptId)
            } else if (!previous) {
                completed.add(JSON.stringify([job.id, job.currentAttemptId]))

                if (completed.size > 2000) {
                    completed.delete(completed.values().next().value!)
                }
            }
        }

        observed.set(job.id, {
            state: job.state,
            attemptId: job.currentAttemptId
        })
    }

    async function refreshDetail(): Promise<void> {
        const id = snapshot.detail.jobId
        if (!connected || id === null) return
        const ownGeneration = generation
        const serial = ++detailSerial
        try {
            const result = await api.get({ jobId: id })
            if (
                !connected ||
                generation !== ownGeneration ||
                serial !== detailSerial ||
                snapshot.detail.jobId !== id
            )
                return
            if (result.ok) {
                const job = structuredClone(result.data)
                observe(job)
                publish({ detail: { jobId: id, data: job, loading: false, error: null } })
            } else {
                publish({
                    detail: {
                        jobId: id,
                        data: null,
                        loading: false,
                        error: structuredClone(result.error)
                    }
                })
            }
        } catch {
            if (
                !connected ||
                generation !== ownGeneration ||
                serial !== detailSerial ||
                snapshot.detail.jobId !== id
            )
                return
            publish({
                detail: {
                    jobId: id,
                    data: null,
                    loading: false,
                    error: {
                        code: 'TRANSPORT_ERROR',
                        message: '작업 상세를 불러오지 못했습니다. 새로고침하세요.',
                        context: {}
                    }
                }
            })
        }
    }

    async function openDetail(jobId: string): Promise<void> {
        ++detailSerial
        publish({ detail: { jobId, data: null, loading: true, error: null } })
        await refreshDetail()
    }

    function closeDetail(): void {
        ++detailSerial
        publish({ detail: { jobId: null, data: null, loading: false, error: null } })
    }

    async function refresh(offset = snapshot.offset) {
        if (!connected) return

        const ownGeneration = generation
        const serial = ++readSerial

        publish({ loading: true })

        try {
            const result = await api.list({
                limit: DOWNLOAD_PAGE_SIZE,
                offset
            })

            if (!connected || generation !== ownGeneration || serial !== readSerial) {
                return
            }

            if (!result.ok) {
                publish({
                    loading: false,
                    ready: false,
                    error: structuredClone(result.error)
                })
                return
            }

            const page = structuredClone(result.data)

            for (const job of page.data) {
                observe(job)
            }

            const keep = new Set([
                ...page.data.map((job) => job.id),
                ...requested,
                ...(snapshot.detail.jobId ? [snapshot.detail.jobId] : [])
            ])

            for (const id of observed.keys()) {
                if (!keep.has(id)) observed.delete(id)
            }

            publish({
                queue: page.data,
                offset: page.offset,
                hasNextPage: page.hasNextPage,
                loading: false,
                ready: true,
                error: null
            })
            await refreshDetail()
        } catch {
            if (!connected || generation !== ownGeneration || serial !== readSerial) {
                return
            }

            const result = failure('TRANSPORT_ERROR', '작업 목록을 불러오지 못했습니다.')

            if (!result.ok) {
                publish({
                    loading: false,
                    ready: false,
                    error: result.error
                })
            }
        }
    }

    function halt(message: string) {
        if (snapshot.halted) return

        publish({ halted: message })
        notice(message, 'error')
    }

    async function runJob(jobId: string, trigger: ManualDownloadTrigger) {
        if (!connected || !snapshot.ready || snapshot.halted || requested.has(jobId)) {
            return
        }

        requested.add(jobId)
        publish({ requestedIds: [...requested] })

        try {
            // 순차 실행은 main의 DownloadService가 소유한다.
            const result = await api.run({ jobId, trigger })

            if (!result.ok) {
                if (
                    [
                        'DATABASE_ERROR',
                        'COMMIT_STATE_UNKNOWN',
                        'NOT_READY',
                        'INTERNAL_ERROR'
                    ].includes(result.error.code)
                ) {
                    halt('실행 상태를 확인해야 하므로 추가 실행 요청을 보류했습니다.')
                } else {
                    notice(result.error.message, 'error')
                }
            } else if (result.data.status === 'blocked') {
                halt('작업 상태 확인이 필요합니다. 추가 실행 요청을 보류했습니다.')
            } else if (result.data.status === 'committed') {
                commit(result.data.jobId, result.data.attemptId)

                notice('다운로드 등록이 완료되었습니다.', 'success')
            } else {
                notice('이번 실행은 정리가 필요합니다. 작업 목록을 확인하세요.', 'info')
            }
        } catch {
            halt('실행 응답을 받지 못했습니다. 결과 확인 전까지 추가 실행 요청을 보류합니다.')
        } finally {
            requested.delete(jobId)
            publish({ requestedIds: [...requested] })
            await refresh()
        }
    }

    async function startDownload(url: string): Promise<DownloadResponse<DownloadJobDto>> {
        if (!connected || !snapshot.ready) {
            return failure('NOT_READY', '다운로드 연결을 준비 중입니다.')
        }

        if (snapshot.halted) {
            return failure('RUNS_PAUSED', snapshot.halted)
        }

        const ownGeneration = generation
        ++readSerial

        try {
            const result = await api.enqueue({
                mode: 'create',
                url: url.trim()
            })

            if (result.ok && connected && generation === ownGeneration) {
                const job = structuredClone(result.data)

                observe(job)

                publish({
                    queue: [job, ...snapshot.queue.filter((item) => item.id !== job.id)].slice(
                        0,
                        DOWNLOAD_PAGE_SIZE
                    ),
                    offset: 0
                })

                void runJob(job.id, 'manual_initial')
            }

            return result
        } catch {
            return failure(
                'TRANSPORT_ERROR',
                '등록 응답을 받지 못했습니다. 작업 목록을 확인하세요.'
            )
        } finally {
            if (connected && generation === ownGeneration) {
                void refresh(0)
            }
        }
    }

    async function cancelDownload(jobId: string) {
        if (!connected || cancelling.has(jobId)) {
            return
        }

        cancelling.add(jobId)
        publish({ cancellingIds: [...cancelling] })

        try {
            const result = await api.cancel({ jobId })

            notice(
                result.ok
                    ? '취소 요청을 전달했습니다. 최종 상태를 확인하세요.'
                    : result.error.message,
                result.ok ? 'info' : 'error'
            )
        } catch {
            notice('취소 응답을 받지 못했습니다. 작업 상태를 다시 확인하세요.', 'error')
        } finally {
            cancelling.delete(jobId)
            publish({ cancellingIds: [...cancelling] })
            await refresh()
        }
    }

    return {
        getSnapshot: () => snapshot,

        subscribe(listener) {
            listeners.add(listener)

            return () => {
                listeners.delete(listener)
            }
        },

        connect(callback) {
            if (connected) {
                throw new Error('Download store is already connected')
            }

            connected = true
            notify = callback

            const ownGeneration = ++generation

            async function tick() {
                await refresh()

                if (connected && generation === ownGeneration) {
                    timer = setTimeout(() => {
                        void tick()
                    }, pollMs)
                }
            }

            void tick()

            return () => {
                if (!connected || generation !== ownGeneration) {
                    return
                }

                connected = false
                notify = undefined
                ++generation
                ++readSerial
                ++detailSerial

                if (timer !== undefined) {
                    clearTimeout(timer)
                }

                timer = undefined

                publish({
                    ready: false,
                    loading: false
                })
            }
        },

        refresh,
        startDownload,
        runJob,
        cancelDownload,
        openDetail,
        closeDetail
    }
}
