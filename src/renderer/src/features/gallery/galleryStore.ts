import type { MediaApi } from '../../../../shared/media-api'
import type {
    MediaDetailDto,
    MediaEditRequest,
    MediaErrorCode,
    MediaPage,
    MediaResult,
    MediaSummaryDto,
    MediaUnregisterFilesRequest,
    MediaUnregisterRequest,
    MediaUnregisterResult,
    MediaFilter
} from '../../../../shared/media-v2'

export interface MediaViewError {
    code: MediaErrorCode | 'TRANSPORT_ERROR'
    message: string
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'not_ready'

export interface GallerySnapshot {
    list: {
        status: Status
        page: MediaPage<MediaSummaryDto>
        offset: number
        error: MediaViewError | null
    }
    detail: {
        mediaId: number | null
        status: Status
        data: MediaDetailDto | null
        offset: number
        error: MediaViewError | null
    }
    busy: boolean
    needsRefresh: boolean
    writeError: MediaViewError | null
    notice: string | null
}

export const MEDIA_PAGE_SIZE = 50

const transportError: MediaViewError = {
    code: 'TRANSPORT_ERROR',
    message: '응답을 확인하지 못했습니다. 새로고침으로 현재 상태를 확인하세요.'
}

export function createGalleryStore(
    api: MediaApi,
    options: {
        favoritesOnly?: boolean
    } = {}
) {
    const favoritesOnly = options.favoritesOnly ?? false
    let filter: MediaFilter = {}
    let snapshot: GallerySnapshot = {
        list: {
            status: 'idle',
            page: {
                data: [],
                total: 0,
                hasNextPage: false
            },
            offset: 0,
            error: null
        },
        detail: {
            mediaId: null,
            status: 'idle',
            data: null,
            offset: 0,
            error: null
        },
        busy: false,
        needsRefresh: false,
        writeError: null,
        notice: null
    }

    const listeners = new Set<() => void>()
    let listToken = 0
    let detailToken = 0
    let refreshQueued = false
    let session = 0

    function publish(next: GallerySnapshot) {
        snapshot = next
        listeners.forEach((listener) => listener())
    }

    async function request<T>(
        action: () => Promise<MediaResult<T>>
    ): Promise<{ ok: true; data: T } | { ok: false; error: MediaViewError }> {
        try {
            return await action()
        } catch {
            return {
                ok: false,
                error: transportError
            }
        }
    }

    function cancelReads() {
        session++
        listToken++
        detailToken++

        publish({
            ...snapshot,
            list:
                snapshot.list.status === 'loading'
                    ? { ...snapshot.list, status: 'idle' }
                    : snapshot.list,
            detail:
                snapshot.detail.status === 'loading'
                    ? { ...snapshot.detail, status: 'idle' }
                    : snapshot.detail
        })
    }

    async function loadList(offset = snapshot.list.offset, internal = false): Promise<boolean> {
        if (snapshot.busy && !internal) {
            refreshQueued = true
            return false
        }

        const token = ++listToken

        publish({
            ...snapshot,
            list: {
                ...snapshot.list,
                status: 'loading',
                offset,
                error: null
            }
        })

        const result = await request(() =>
            api.list({
                limit: MEDIA_PAGE_SIZE,
                favoritesOnly,
                filter: structuredClone(filter),
                offset
            })
        )

        if (token !== listToken) return false

        if (!result.ok) {
            publish({
                ...snapshot,
                list: {
                    ...snapshot.list,
                    status: result.error.code === 'NOT_READY' ? 'not_ready' : 'error',
                    error: result.error
                }
            })
            return false
        }

        if (offset > 0 && offset >= result.data.total) {
            const last = Math.max(
                0,
                Math.floor((result.data.total - 1) / MEDIA_PAGE_SIZE) * MEDIA_PAGE_SIZE
            )
            return loadList(last, internal)
        }

        publish({
            ...snapshot,
            list: {
                status: 'ready',
                page: result.data,
                offset,
                error: null
            }
        })

        return true
    }

    async function loadDetail(offset = snapshot.detail.offset, internal = false): Promise<boolean> {
        const mediaId = snapshot.detail.mediaId

        if (mediaId === null || (snapshot.busy && !internal)) {
            return false
        }

        const token = ++detailToken

        publish({
            ...snapshot,
            detail: {
                ...snapshot.detail,
                status: 'loading',
                offset,
                error: null
            }
        })

        const result = await request(() =>
            api.get({
                mediaId,
                fileLimit: MEDIA_PAGE_SIZE,
                fileOffset: offset
            })
        )

        if (token !== detailToken || snapshot.detail.mediaId !== mediaId) {
            return false
        }

        if (!result.ok) {
            publish({
                ...snapshot,
                detail: {
                    ...snapshot.detail,
                    status: result.error.code === 'NOT_READY' ? 'not_ready' : 'error',
                    error: result.error
                }
            })
            return false
        }

        if (offset > 0 && offset >= result.data.files.total) {
            const last = Math.max(
                0,
                Math.floor((result.data.files.total - 1) / MEDIA_PAGE_SIZE) * MEDIA_PAGE_SIZE
            )
            return loadDetail(last, internal)
        }

        publish({
            ...snapshot,
            detail: {
                mediaId,
                status: 'ready',
                data: result.data,
                offset,
                error: null
            }
        })

        return true
    }

    async function refresh(internal = false): Promise<boolean> {
        if (snapshot.busy && !internal) {
            refreshQueued = true
            return false
        }

        const results = await Promise.all([
            loadList(snapshot.list.offset, internal),
            snapshot.detail.mediaId === null
                ? Promise.resolve(true)
                : loadDetail(snapshot.detail.offset, internal)
        ])

        const complete = results.every(Boolean)

        if (complete) {
            publish({
                ...snapshot,
                needsRefresh: false,
                writeError: null
            })
        }

        return complete
    }

    async function mutate<T>(
        action: () => Promise<MediaResult<T>>,
        apply: (data: T) => void
    ): Promise<boolean> {
        if (snapshot.busy || snapshot.needsRefresh) {
            return false
        }

        cancelReads()
        const operationSession = session

        publish({
            ...snapshot,
            busy: true,
            writeError: null,
            notice: null
        })

        try {
            const result = await request(action)

            if (operationSession !== session) {
                return result.ok
            }

            if (!result.ok) {
                publish({
                    ...snapshot,
                    writeError: result.error,
                    needsRefresh:
                        result.error.code === 'REVISION_CONFLICT' ||
                        result.error.code === 'TRANSPORT_ERROR'
                })
                return false
            }

            apply(result.data)

            // 성공한 변경과 후속 조회 실패를 구분한다.
            publish({
                ...snapshot,
                notice: '변경을 반영했습니다.',
                detail: {
                    ...snapshot.detail,
                    data: null
                }
            })

            const loaded = await refresh(true)

            if (operationSession === session && !loaded) {
                publish({
                    ...snapshot,
                    needsRefresh: true,
                    notice: '변경은 반영됐지만 화면을 다시 불러오지 못했습니다. 새로고침하세요.'
                })
            }

            return true
        } finally {
            publish({
                ...snapshot,
                busy: false
            })

            if (refreshQueued) {
                refreshQueued = false
                void refresh()
            }
        }
    }

    function edited(media: MediaSummaryDto) {
        const page = snapshot.list.page

        const listed = page.data.some((previous) => previous.id === media.id)

        const removeFromList = favoritesOnly && !media.isFavorite

        const data = removeFromList
            ? page.data.filter((previous) => previous.id !== media.id)
            : page.data.map((previous) => (previous.id === media.id ? media : previous))

        const total = removeFromList && listed ? Math.max(0, page.total - 1) : page.total

        publish({
            ...snapshot,
            list: {
                ...snapshot.list,
                page: {
                    data,
                    total,
                    hasNextPage: snapshot.list.offset + data.length < total
                }
            }
        })
    }

    function removed(result: MediaUnregisterResult) {
        if (result.parentRemoved) {
            const page = snapshot.list.page

            const wasListed =
                page.data.some((media) => media.id === result.mediaId) ||
                (Object.keys(filter).length === 0 &&
                    (!favoritesOnly ||
                        (snapshot.detail.data?.id === result.mediaId &&
                            snapshot.detail.data.isFavorite)))

            const data = page.data.filter((media) => media.id !== result.mediaId)

            const total = wasListed ? Math.max(0, page.total - 1) : page.total

            publish({
                ...snapshot,
                list: {
                    ...snapshot.list,
                    page: {
                        data,
                        total,
                        hasNextPage: snapshot.list.offset + data.length < total
                    }
                }
            })
        }

        if (result.parentRemoved && snapshot.detail.mediaId === result.mediaId) {
            detailToken++

            publish({
                ...snapshot,
                detail: {
                    mediaId: null,
                    status: 'idle',
                    data: null,
                    offset: 0,
                    error: null
                }
            })
        }
    }

    return {
        getSnapshot: () => snapshot,

        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },

        cancelReads,

        setFilter(next: MediaFilter = {}) {
            const copied = structuredClone(next)

            if (JSON.stringify(filter) === JSON.stringify(copied)) {
                return
            }

            filter = copied
            listToken++

            publish({
                ...snapshot,
                list: {
                    status: 'idle',
                    page: {
                        data: [],
                        total: 0,
                        hasNextPage: false
                    },
                    offset: 0,
                    error: null
                }
            })
        },

        refresh: () => refresh(),

        loadList: (offset: number) => loadList(offset),

        loadDetail: (offset: number) => loadDetail(offset),

        async openDetail(mediaId: number) {
            if (snapshot.busy) return false

            detailToken++

            publish({
                ...snapshot,
                writeError: null,
                detail: {
                    mediaId,
                    status: 'idle',
                    data: null,
                    offset: 0,
                    error: null
                }
            })

            return loadDetail(0)
        },

        closeDetail() {
            if (snapshot.busy) return

            detailToken++

            publish({
                ...snapshot,
                detail: {
                    mediaId: null,
                    status: 'idle',
                    data: null,
                    offset: 0,
                    error: null
                }
            })
        },

        edit: (input: MediaEditRequest) => mutate(() => api.edit(input), edited),

        unregisterFiles: (input: MediaUnregisterFilesRequest) =>
            mutate(() => api.unregisterFiles(input), removed),

        unregisterMedia: (input: MediaUnregisterRequest) =>
            mutate(() => api.unregisterMedia(input), removed)
    }
}

export type GalleryStore = ReturnType<typeof createGalleryStore>
