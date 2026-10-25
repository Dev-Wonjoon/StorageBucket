import { useState } from 'react'
import { MEDIA_PAGE_SIZE } from './galleryStore'
import { MediaPreview } from '@renderer/shared/components/media/MediaPreview'
import { MediaDetailPane } from './MediaDetailPane'
import { useGalleryViewModel } from './useGalleryViewModel'
import type { MediaFilter } from '../../../../shared/media-v2'

export const GalleryPage = ({
    favoritesOnly = false,
    title = '갤러리',
    filter,
    showDownloads = true,
    emptyMessage = '등록된 묶음이 없습니다.'
}: {
    favoritesOnly?: boolean
    title?: string
    filter?: MediaFilter
    showDownloads?: boolean
    emptyMessage?: string
} = {}): React.JSX.Element => {
    const {
        store,
        snapshot: state,
        activeDownloads
    } = useGalleryViewModel(favoritesOnly, filter, showDownloads)

    const [draftDirty, setDraftDirty] = useState(false)

    const list = state.list

    const disabled = state.busy || list.status !== 'ready'

    const button =
        'rounded-lg border border-[var(--border-line)] px-3 py-2 text-sm disabled:opacity-40'

    return (
        <div className="space-y-5 pb-10">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-lg font-semibold">갤러리</h1>

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

            {activeDownloads.length > 0 && (
                <section aria-label="진행 중 다운로드" className="space-y-2">
                    <h2 className="text-sm font-medium">진행 중 다운로드</h2>

                    {activeDownloads.map((job) => (
                        <div
                            key={job.id}
                            className="rounded-lg border border-[var(--border-line)] p-3 text-sm"
                        >
                            <p className="truncate">{job.title || job.url}</p>

                            <p className="text-[var(--text-muted)]">
                                {job.state === 'pending'
                                    ? '대기 중'
                                    : job.phase === 'committing'
                                      ? '저장 중'
                                      : job.phase === 'verifying'
                                        ? '파일 확인 중'
                                        : job.phase === 'discovering'
                                          ? '대상 확인 중'
                                          : '다운로드 중'}

                                {job.progress !== undefined
                                    ? ' · ' + job.progress.toFixed(1) + '%'
                                    : ''}
                            </p>
                        </div>
                    ))}
                </section>
            )}

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

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {list.page.data.map((media) => (
                    <button
                        type="button"
                        key={media.id}
                        disabled={disabled}
                        aria-pressed={state.detail.mediaId === media.id}
                        onClick={() => {
                            if (state.detail.mediaId === media.id) {
                                return
                            }

                            if (
                                draftDirty &&
                                !window.confirm('작성 중인 제목을 버리고 다른 묶음을 열까요?')
                            ) {
                                return
                            }

                            void store.openDetail(media.id)
                        }}
                        className={
                            'overflow-hidden rounded-xl border text-left disabled:opacity-50 ' +
                            (state.detail.mediaId === media.id
                                ? 'border-[var(--color-primary)]'
                                : 'border-[var(--border-line)]')
                        }
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

                                {media.isFavorite ? ' · 즐겨찾기' : ''}
                            </p>

                            <p className="text-xs text-[var(--text-muted)]">
                                {new Date(media.createdAt).toLocaleDateString()}
                            </p>
                        </div>
                    </button>
                ))}
            </div>

            {list.page.total > 0 && (
                <nav aria-label={title + ' 페이지'} className="flex items-center gap-3">
                    <button
                        type="button"
                        className={button}
                        disabled={disabled || list.offset === 0}
                        onClick={() =>
                            void store.loadList(Math.max(0, list.offset - MEDIA_PAGE_SIZE))
                        }
                    >
                        이전
                    </button>

                    <span className="text-sm">
                        {Math.floor(list.offset / MEDIA_PAGE_SIZE) + 1}
                        {' 페이지'}
                    </span>

                    <button
                        type="button"
                        className={button}
                        disabled={disabled || !list.page.hasNextPage}
                        onClick={() => void store.loadList(list.offset + MEDIA_PAGE_SIZE)}
                    >
                        다음
                    </button>
                </nav>
            )}

            {state.detail.mediaId !== null && (
                <MediaDetailPane
                    key={state.detail.mediaId}
                    state={state}
                    store={store}
                    onDirtyChange={setDraftDirty}
                />
            )}
        </div>
    )
}
