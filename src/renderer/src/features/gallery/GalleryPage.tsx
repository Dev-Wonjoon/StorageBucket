import { useCallback, useEffect, useRef, useState } from 'react'
import { useInfiniteScroll } from '@renderer/shared/hooks/useInfiniteScroll'
import { ListDetailLayout } from '@renderer/shared/components/layout/ListDetailLayout'
import { useLeaveGuard } from '@renderer/shared/hooks/useLeaveGuard'
import { confirmDiscard } from '@renderer/shared/utils/leaveGuard'
import { MediaPreview } from '@renderer/shared/components/media/MediaPreview'
import { MediaDetailPane, type MediaDetailFocusRequest } from './MediaDetailPane'
import { GalleryCardActions } from './GalleryCardActions'
import { useGalleryViewModel } from './useGalleryViewModel'
import type { MediaFilter } from '../../../../shared/media-v2'

export const GalleryPage = ({
    favoritesOnly = false,
    title = '갤러리',
    filter,
    emptyMessage = '등록된 묶음이 없습니다.'
}: {
    favoritesOnly?: boolean
    title?: string
    filter?: MediaFilter
    emptyMessage?: string
} = {}): React.JSX.Element => {
    const { store, snapshot: state, openInFolder } = useGalleryViewModel(favoritesOnly, filter)

    const [draftDirty, setDraftDirty] = useState(false)
    const dirtyRef = useRef(false)
    const onDirtyChange = useCallback((dirty: boolean) => {
        dirtyRef.current = dirty
        setDraftDirty(dirty)
    }, [])
    useLeaveGuard(draftDirty, state.busy)
    const [editFocus, setEditFocus] = useState<MediaDetailFocusRequest | null>(null)
    const editSequence = useRef(0)
    const listScrollRef = useRef<HTMLDivElement>(null)
    const sentinelRef = useRef<HTMLDivElement>(null)

    const filterKey = JSON.stringify(filter ?? {})

    useEffect(() => {
        listScrollRef.current?.scrollTo({ top: 0 })
    }, [filterKey, favoritesOnly])

    const list = state.list

    useInfiniteScroll({
        rootRef: listScrollRef,
        targetRef: sentinelRef,
        enabled:
            list.status === 'ready' &&
            list.page.hasNextPage &&
            !list.refreshing &&
            !list.loadingMore &&
            !list.error &&
            !list.moreError &&
            !state.busy &&
            !state.needsRefresh,
        onLoadMore: store.loadMore
    })

    function selectDetail(mediaId: number): boolean {
        const current = store.getSnapshot()
        if (current.busy) return false
        if (current.detail.mediaId === mediaId) return true
        if (!confirmDiscard(dirtyRef.current)) return false
        setEditFocus(null)
        void store.openDetail(mediaId)
        return true
    }
    function editDetail(mediaId: number, field: 'title' | 'tags'): void {
        if (selectDetail(mediaId))
            setEditFocus({ mediaId, field, sequence: ++editSequence.current })
    }
    function toggleFavorite(mediaId: number): void {
        const current = store.getSnapshot()
        if (current.busy || current.needsRefresh || dirtyRef.current) return
        const media = current.list.page.data.find((item) => item.id === mediaId)
        if (!media) return
        void store.edit({
            mediaId,
            expectedRevision: media.revision,
            isFavorite: !media.isFavorite
        })
    }
    function unregisterMedia(mediaId: number): void {
        const current = store.getSnapshot()
        if (current.busy || current.needsRefresh) return
        const media = current.list.page.data.find((item) => item.id === mediaId)
        if (!media) return
        if (current.detail.mediaId === mediaId && !confirmDiscard(dirtyRef.current)) return
        if (
            !window.confirm(
                '묶음의 등록을 해제할까요? 외부 원본과 보관 방식 미확인 원본은 삭제하지 않습니다. 앱 관리 파일의 정리는 별도로 처리합니다.'
            )
        )
            return
        void store.unregisterMedia({ mediaId, expectedRevision: media.revision })
    }
    function closeDetail(): boolean {
        if (store.getSnapshot().busy || !confirmDiscard(dirtyRef.current)) return false
        setEditFocus(null)
        store.closeDetail()
        return true
    }

    const disabled = state.busy || list.status !== 'ready'

    const button =
        'rounded-lg border border-[var(--border-line)] px-3 py-2 text-sm disabled:opacity-40'

    return (
        <ListDetailLayout
            detailLabel="미디어 상세"
            detailKey={state.detail.mediaId}
            onClose={closeDetail}
            listRef={listScrollRef}
            closeDisabled={state.busy}
            detail={
                state.detail.mediaId !== null ? (
                    <MediaDetailPane
                        key={state.detail.mediaId}
                        state={state}
                        store={store}
                        onDirtyChange={onDirtyChange}
                        focusRequest={
                            editFocus?.mediaId === state.detail.mediaId ? editFocus : null
                        }
                    />
                ) : undefined
            }
        >
            <div className="space-y-5 pb-6">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <h1 className="text-lg font-semibold">{title}</h1>

                    <div className="flex items-center gap-3">
                        {list.status === 'ready' && (
                            <span className="text-sm text-[var(--text-muted)]">
                                총 {list.page.total}개 묶음
                            </span>
                        )}

                        <button
                            type="button"
                            className={button}
                            disabled={state.busy}
                            onClick={() => void store.refresh()}
                        >
                            새로고침
                        </button>
                    </div>
                </header>

                {state.notice && (
                    <p role="status" className="text-sm">
                        {state.notice}
                    </p>
                )}

                {state.writeError && (
                    <p role="alert" className="text-sm">
                        {state.writeError.message}
                        {state.needsRefresh ? ' 새로고침 후 현재 정보를 확인하세요.' : ''}
                    </p>
                )}

                {list.status === 'loading' && <p role="status">묶음을 불러오는 중...</p>}

                {list.error && (
                    <div role="alert" className="rounded-lg border border-[var(--border-line)] p-4">
                        <p>
                            {list.status === 'not_ready'
                                ? '라이브러리 연결을 준비 중입니다.'
                                : list.error.message}
                        </p>

                        <p className="mt-1 text-sm text-[var(--text-muted)]">
                            새로고침으로 다시 확인할 수 있습니다.
                        </p>
                    </div>
                )}

                {list.status === 'ready' && list.page.total === 0 && (
                    <p className="py-16 text-center text-[var(--text-muted)]">{emptyMessage}</p>
                )}

                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-5">
                    {list.page.data.map((media) => (
                        <article
                            key={media.id}
                            data-detail-trigger
                            className={
                                'relative rounded-xl border bg-[var(--bg-sidebar)] text-left ' +
                                (state.detail.mediaId === media.id
                                    ? 'border-[var(--color-primary)]'
                                    : 'border-[var(--border-line)]')
                            }
                        >
                            <button
                                type="button"
                                disabled={disabled}
                                aria-pressed={state.detail.mediaId === media.id}
                                aria-label={media.title + ' 상세보기'}
                                onClick={() => {
                                    selectDetail(media.id)
                                }}
                                className="block w-full overflow-hidden rounded-t-xl text-left disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                            >
                                <MediaPreview
                                    path={media.cover?.path ?? null}
                                    title={media.title}
                                    className="aspect-video w-full bg-[var(--bg-active)] object-cover"
                                />

                                <div className="space-y-1 p-3">
                                    <h2 className="truncate font-medium">{media.title}</h2>

                                    <p className="text-xs text-[var(--text-muted)]">
                                        {media.sourceKind === 'local'
                                            ? '로컬 폴더'
                                            : media.sourceKind === 'download'
                                              ? '다운로드'
                                              : '기존 자료'}

                                        {' · 파일 ' + media.fileCount + '개'}
                                    </p>

                                    <p className="text-xs text-[var(--text-muted)]">
                                        {new Date(media.createdAt).toLocaleDateString()}
                                    </p>
                                </div>
                            </button>
                            <GalleryCardActions
                                title={media.title}
                                isFavorite={media.isFavorite}
                                disabled={disabled}
                                mutationDisabled={state.needsRefresh}
                                favoriteDisabledReason={
                                    draftDirty
                                        ? '제목·태그 편집을 저장한 뒤 즐겨찾기를 변경하세요.'
                                        : undefined
                                }
                                onToggleFavorite={() => toggleFavorite(media.id)}
                                onOpenFolder={() => void openInFolder(media.id)}
                                onEdit={(field) => editDetail(media.id, field)}
                                onUnregister={() => unregisterMedia(media.id)}
                            />
                        </article>
                    ))}
                </div>

                {list.page.total > 0 && (
                    <div className="space-y-3 py-4 text-center">
                        <div ref={sentinelRef} className="h-px" aria-hidden="true" />

                        {list.loadingMore && (
                            <p role="status" className="text-sm text-[var(--text-muted)]">
                                더 불러오는 중...
                            </p>
                        )}

                        {list.moreError && (
                            <p role="alert" className="text-sm">
                                {list.moreError.message}
                            </p>
                        )}

                        {list.page.hasNextPage && !list.error && (
                            <button
                                type="button"
                                data-detail-trigger
                                className={button}
                                disabled={
                                    list.loadingMore ||
                                    list.refreshing ||
                                    state.busy ||
                                    state.needsRefresh
                                }
                                onClick={() => void store.loadMore()}
                            >
                                {list.moreError ? '다시 시도' : '더 불러오기'}
                            </button>
                        )}

                        {list.status === 'ready' &&
                            !list.page.hasNextPage &&
                            list.page.data.length > 0 && (
                                <p className="text-sm text-[var(--text-muted)]">
                                    모든 항목을 불러왔습니다.
                                </p>
                            )}
                    </div>
                )}
            </div>
        </ListDetailLayout>
    )
}
