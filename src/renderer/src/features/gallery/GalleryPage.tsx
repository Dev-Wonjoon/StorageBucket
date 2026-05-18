import { type ReactElement, useMemo, useState } from 'react'
import {
    ArrowDownAZ,
    ExternalLink,
    Filter,
    FolderOpen,
    Grid3X3,
    List,
    MoreHorizontal,
    Search,
    Tags,
    Trash2
} from 'lucide-react'
import { PhotoCard } from './PhotoCard'
import { useGalleryViewModel } from './useGalleryViewModel'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { TagModal } from '@renderer/components/TagModal'
import { Media } from 'src/shared/types'

type ViewMode = 'grid' | 'list' | 'queue'

const formatBytes = (bytes?: number | null): string => {
    if (!bytes || bytes <= 0) return '알 수 없음'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unit = 0

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }

    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

const getImageUrl = (media?: Media | null): string | null => {
    if (!media?.thumbnailPath) return null
    return `media:///${media.thumbnailPath.replace(/\\/g, '/')}`
}

const DetailPanel = ({
    media,
    onDelete,
    onOpenTagModal
}: {
    media?: Media | null
    onDelete: (id: number) => void
    onOpenTagModal: (ids: number[]) => void
}): ReactElement => {
    const imageUrl = getImageUrl(media)

    return (
        <aside className="sb-detail" aria-label="선택한 미디어 상세">
            <header className="sb-detail-head">
                <strong className="text-sm">상세 정보</strong>
                <button className="sb-icon-button" type="button" title="더보기" aria-label="더보기">
                    <MoreHorizontal size={18} strokeWidth={1.8} />
                </button>
            </header>

            <div className="sb-detail-body">
                {media ? (
                    <>
                        <div className="sb-detail-preview">
                            {imageUrl ? (
                                <img src={imageUrl} alt={`${media.title} 미리보기`} />
                            ) : (
                                <div className="sb-thumb-empty" />
                            )}
                        </div>
                        <h2 className="sb-detail-title">{media.title}</h2>
                        <p className="sb-detail-url" title={media.url || media.filepath}>
                            {media.url || media.filepath || '저장 위치 없음'}
                        </p>

                        <div className="sb-info-list">
                            <div className="sb-info-row">
                                <span>플랫폼</span>
                                <strong>{media.platform || '미분류'}</strong>
                            </div>
                            <div className="sb-info-row">
                                <span>작성자</span>
                                <strong>{media.author || 'unknown'}</strong>
                            </div>
                            <div className="sb-info-row">
                                <span>파일</span>
                                <strong>{formatBytes(media.filesize)}</strong>
                            </div>
                            <div className="sb-info-row">
                                <span>저장일</span>
                                <strong>
                                    {new Date(media.createdAt).toLocaleDateString('ko-KR')}
                                </strong>
                            </div>
                        </div>

                        <div className="sb-section-label">Tags</div>
                        <div className="sb-tag-cloud">
                            <span className="sb-chip is-active">{media.platform || 'media'}</span>
                            {media.isFavorite && <span className="sb-chip">즐겨찾기</span>}
                            <span className="sb-chip">미분류</span>
                        </div>
                    </>
                ) : (
                    <div className="sb-empty-state h-full">
                        <p className="text-sm font-semibold text-[var(--text-main)]">
                            선택된 미디어가 없습니다
                        </p>
                        <p className="mt-1 text-xs">카드를 선택하면 상세 정보가 표시됩니다.</p>
                    </div>
                )}
            </div>

            <div className="sb-detail-actions">
                <button
                    className="sb-action-button is-primary"
                    type="button"
                    disabled={!media?.filepath}
                    onClick={() =>
                        media?.filepath &&
                        window.electron?.ipcRenderer?.invoke('shell:show-item', media.filepath)
                    }
                >
                    <ExternalLink size={16} strokeWidth={1.8} />
                    열기
                </button>
                <button
                    className="sb-action-button"
                    type="button"
                    disabled={!media}
                    onClick={() => media && onOpenTagModal([media.id])}
                >
                    <Tags size={16} strokeWidth={1.8} />
                    태그
                </button>
                <button
                    className="sb-action-button"
                    type="button"
                    disabled={!media}
                    onClick={() => media && onDelete(media.id)}
                >
                    <Trash2 size={16} strokeWidth={1.8} />
                    삭제
                </button>
            </div>
        </aside>
    )
}

export const GalleryPage = (): ReactElement => {
    const [query, setQuery] = useState('')
    const [viewMode, setViewMode] = useState<ViewMode>('grid')
    const {
        galleryItems,
        selectedId,
        selectedIds,
        contextMenu,
        tagModal,
        isLoading,
        handleSelect,
        toggleFavorite,
        deleteMedia,
        handleContextMenu,
        closeContextMenu,
        openTagModal,
        closeTagModal,
        refresh
    } = useGalleryViewModel()

    const visibleItems = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        const source =
            viewMode === 'queue' ? galleryItems.filter((item) => item.isDownloading) : galleryItems

        if (!keyword) return source

        return source.filter(({ media }) => {
            return [media.title, media.author, media.platform, media.url, media.filepath]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(keyword))
        })
    }, [galleryItems, query, viewMode])

    const selectedMedia = useMemo(() => {
        if (selectedId === null) return null

        const selected = galleryItems.find(
            (item) => item.media.id === selectedId && !item.isDownloading
        )
        return selected?.media ?? null
    }, [galleryItems, selectedId])

    const selectedCount = selectedIds.size + (selectedId ? 1 : 0)
    const activeDownloads = galleryItems.filter((item) => item.isDownloading).length

    if (isLoading && galleryItems.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
                <div className="flex flex-col items-center gap-2">
                    <FolderOpen size={28} strokeWidth={1.7} />
                    <p>미디어를 불러오는 중...</p>
                </div>
            </div>
        )
    }

    return (
        <div className={`sb-page-shell ${selectedMedia ? 'has-detail' : ''}`}>
            <section className="sb-library">
                <header>
                    <h1 className="sb-page-title">라이브러리</h1>
                    <p className="sb-page-subtitle">
                        최근 저장한 미디어 {galleryItems.length}개 · 선택 {selectedCount}개 · 진행
                        중 {activeDownloads}개
                    </p>
                </header>

                <div className="sb-filterbar">
                    <div className="sb-input-shell">
                        <Search size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="제목, 채널, 태그 검색"
                            aria-label="라이브러리 검색"
                        />
                        <div className="sb-view-switch" role="tablist" aria-label="보기 방식">
                            <button
                                type="button"
                                className={`sb-view-button ${viewMode === 'grid' ? 'is-active' : ''}`}
                                title="그리드 보기"
                                aria-label="그리드 보기"
                                onClick={() => setViewMode('grid')}
                            >
                                <Grid3X3 size={16} strokeWidth={1.8} />
                            </button>
                            <button
                                type="button"
                                className={`sb-view-button ${viewMode === 'list' ? 'is-active' : ''}`}
                                title="목록 보기"
                                aria-label="목록 보기"
                                onClick={() => setViewMode('list')}
                            >
                                <List size={16} strokeWidth={1.8} />
                            </button>
                            <button
                                type="button"
                                className={`sb-view-button ${viewMode === 'queue' ? 'is-active' : ''}`}
                                title="큐 보기"
                                aria-label="큐 보기"
                                onClick={() => setViewMode('queue')}
                            >
                                <ArrowDownAZ size={16} strokeWidth={1.8} />
                            </button>
                        </div>
                    </div>
                    <div className="sb-tool-group" aria-label="라이브러리 도구">
                        <button
                            className="sb-icon-button"
                            type="button"
                            title="필터"
                            aria-label="필터"
                        >
                            <Filter size={18} strokeWidth={1.8} />
                        </button>
                        <button
                            className="sb-icon-button"
                            type="button"
                            title="정렬"
                            aria-label="정렬"
                        >
                            <ArrowDownAZ size={18} strokeWidth={1.8} />
                        </button>
                    </div>
                </div>

                <div className="sb-gallery-scroll">
                    {visibleItems.length > 0 ? (
                        <div className={viewMode === 'list' ? 'sb-media-list' : 'sb-media-grid'}>
                            {visibleItems.map(({ media, isDownloading, progress, speed, eta }) => (
                                <PhotoCard
                                    key={media.id}
                                    data={media}
                                    isSelected={
                                        selectedId === media.id || selectedIds.has(media.id)
                                    }
                                    onClick={handleSelect}
                                    onContextMenu={handleContextMenu}
                                    onToggleFavorite={toggleFavorite}
                                    onDelete={deleteMedia}
                                    isDownloading={isDownloading}
                                    progress={progress}
                                    speed={speed}
                                    eta={eta}
                                    layout={viewMode === 'list' ? 'list' : 'grid'}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="sb-empty-state">
                            <FolderOpen size={28} strokeWidth={1.7} />
                            <p className="mt-3 text-lg font-semibold text-[var(--text-main)]">
                                표시할 미디어가 없습니다
                            </p>
                            <p className="mt-1 text-sm">URL을 붙여넣어 다운로드를 시작해보세요.</p>
                        </div>
                    )}
                </div>
            </section>

            {selectedMedia && (
                <DetailPanel
                    media={selectedMedia}
                    onDelete={deleteMedia}
                    onOpenTagModal={openTagModal}
                />
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={closeContextMenu}
                    items={[
                        {
                            label: '태그 관리',
                            onClick: () => {
                                const ids =
                                    selectedIds.size > 0 ? [...selectedIds] : [contextMenu.mediaId]
                                openTagModal(ids)
                            }
                        },
                        {
                            label: '삭제',
                            danger: true,
                            onClick: () => deleteMedia(contextMenu.mediaId)
                        }
                    ]}
                />
            )}

            {tagModal && (
                <TagModal
                    mediaIds={tagModal.mediaIds}
                    onClose={closeTagModal}
                    onUpdated={refresh}
                />
            )}
        </div>
    )
}
