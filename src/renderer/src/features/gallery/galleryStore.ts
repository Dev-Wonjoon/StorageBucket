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
        nextOffset: number
        refreshing: boolean
        loadingMore: boolean
        error: MediaViewError | null
        moreError: MediaViewError | null
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

function emptyList(): GallerySnapshot['list'] {
    return {
        status: 'idle',
        page: {
            data: [],
            total: 0,
            hasNextPage: false
        },
        nextOffset: 0,
        refreshing: false,
        loadingMore: false,
        error: null,
        moreError: null
    }
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
        list: emptyList(),
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
            list: {
                ...snapshot.list,
                status: snapshot.list.status === 'loading' ? 'idle' : snapshot.list.status,
                refreshing: false,
                loadingMore: false
            },
            detail:
                snapshot.detail.status === 'loading'
                    ? { ...snapshot.detail, status: 'idle' }
                    : snapshot.detail
        })
    }

    async function loadList(
        mode: 'refresh' | 'append' = 'refresh',
        internal = false
    ): Promise<boolean> {
        const append = mode === 'append'
        const previous = snapshot.list

        if (snapshot.busy && !internal) {
            if (!append) refreshQueued = true
            return false
        }

        if (
            append &&
            (snapshot.needsRefresh ||
                previous.status !== 'ready' ||
                previous.refreshing ||
                previous.loadingMore ||
                previous.error !== null ||
                !previous.page.hasNextPage)
        ) {
            return false
        }

        const token = ++listToken
        const requestedFilter = structuredClone(filter)

        // 변경 후 재조회할 때 이미 불러온 범위를 유지한다.
        const refreshCount = Math.max(MEDIA_PAGE_SIZE, previous.nextOffset)

        let offset = append ? previous.nextOffset : 0
        const rows = append ? [...previous.page.data] : []

        let total = previous.page.total
        let hasNextPage = false

        publish({
            ...snapshot,
            list: {
                ...previous,
                status: previous.page.data.length > 0 ? 'ready' : 'loading',
                refreshing: !append,
                loadingMore: append,
                error: null,
                moreError: null
            }
        })

        function failList(error: MediaViewError): false {
            publish({
                ...snapshot,
                list: {
                    ...snapshot.list,
                    status:
                        snapshot.list.page.data.length > 0
                            ? 'ready'
                            : error.code === 'NOT_READY'
                              ? 'not_ready'
                              : 'error',
                    refreshing: false,
                    loadingMore: false,
                    error: append ? null : error,
                    moreError: append ? error : null
                }
            })

            return false
        }

        do {
            const result = await request(() =>
                api.list({
                    limit: MEDIA_PAGE_SIZE,
                    offset,
                    favoritesOnly,
                    filter: requestedFilter
                })
            )

            // 검색 변경·새로고침·편집 이후 도착한 이전 응답은 무시한다.
            if (token !== listToken) return false

            if (!result.ok) {
                return failList(result.error)
            }

            const page = result.data

            if (page.hasNextPage && page.data.length === 0) {
                return failList({
                    code: 'INVARIANT_VIOLATION',
                    message: '다음 목록을 확인하지 못했습니다. 새로고침하세요.'
                })
            }

            rows.push(...page.data)
            offset += page.data.length

            total = page.total
            hasNextPage = page.hasNextPage
        } while (!append && hasNextPage && offset < refreshCount)

        const byId = new Map<number, MediaSummaryDto>()

        for (const media of rows) {
            byId.set(media.id, media)
        }

        publish({
            ...snapshot,
            list: {
                status: 'ready',
                page: {
                    data: [...byId.values()],
                    total,
                    hasNextPage
                },
                nextOffset: offset,
                refreshing: false,
                loadingMore: false,
                error: null,
                moreError: null
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
            loadList('refresh', internal),
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
        apply: (data: T) => void,
        successNotice: string | null = '변경을 반영했습니다.'
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
                notice: successNotice,
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
                    hasNextPage: data.length < total
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
                        hasNextPage: data.length < total
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
                list: emptyList()
            })
        },

        refresh: () => refresh(),

        loadMore: () => loadList('append'),

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

        edit: (input: MediaEditRequest): Promise<boolean> => {
            const favoriteOnly =
                input.isFavorite !== undefined &&
                Object.keys(input).every((key) =>
                    ['mediaId', 'expectedRevision', 'isFavorite'].includes(key)
                )
            return mutate(() => api.edit(input), edited, favoriteOnly ? null : undefined)
        },

        unregisterFiles: (input: MediaUnregisterFilesRequest) =>
            mutate(() => api.unregisterFiles(input), removed),

        unregisterMedia: (input: MediaUnregisterRequest) =>
            mutate(() => api.unregisterMedia(input), removed)
    }
}

export type GalleryStore = ReturnType<typeof createGalleryStore>
