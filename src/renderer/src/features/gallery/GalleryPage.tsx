import { type ReactElement, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useGalleryViewModel } from './useGalleryViewModel'
import { GalleryDetailPanel } from './GalleryDetailPanel'
import { GalleryToolbar, type GalleryViewMode } from './GalleryToolbar'
import { useGalleryFilter } from './useGalleryFilter'
import { GalleryMediaList } from './GalleryMediaList'
import { GalleryOverlays } from './GalleryOverlays'


export const GalleryPage = (): ReactElement => {
    const [query, setQuery] = useState('')
    const [viewMode, setViewMode] = useState<GalleryViewMode>('grid')
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
        clearSelection,
        handleContextMenu,
        closeContextMenu,
        openTagModal,
        closeTagModal,
        refresh
    } = useGalleryViewModel()

    const { visibleItems, selectedMedia, selectedCount, activeDownloads } = useGalleryFilter({
        galleryItems,
        query,
        viewMode,
        selectedId,
        selectedIds
    });

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
        <div className={`sb-page-shell ${selectedMedia ? 'has-detail' : ''}`}
            onClick={clearSelection}
        >
            <section className="sb-library">
                <header>
                    <h1 className="sb-page-title">라이브러리</h1>
                    <p className="sb-page-subtitle">
                        최근 저장한 미디어 {galleryItems.length}개 · 선택 {selectedCount}개 · 진행
                        중 {activeDownloads}개
                    </p>
                </header>

                <GalleryToolbar
                    query={query}
                    viewMode={viewMode}
                    onQueryChange={setQuery}
                    onViewModeChange={setViewMode}
                />

                <GalleryMediaList
                    visibleItems={visibleItems}
                    viewMode={viewMode}
                    selectedId={selectedId}
                    selectedIds={selectedIds}
                    onSelect={handleSelect}
                    onContextMenu={handleContextMenu}
                    onToggleFavorite={toggleFavorite}
                    onDelete={deleteMedia}
                />
            </section>

            {selectedMedia && (
                <GalleryDetailPanel
                    media={selectedMedia}
                    onDelete={deleteMedia}
                    onOpenTagModal={openTagModal}
                    onFilterAuthor={(author) => setQuery(author)}
                />
            )}

            <GalleryOverlays
                contextMenu={contextMenu}
                tagModal={tagModal}
                selectedIds={selectedIds}
                onCloseContextMenu={closeContextMenu}
                onOpenTagModal={openTagModal}
                onDeleteMedia={deleteMedia}
                onCloseTagModal={closeTagModal}
                onUpdated={refresh}
            />
        </div>
    )
}
