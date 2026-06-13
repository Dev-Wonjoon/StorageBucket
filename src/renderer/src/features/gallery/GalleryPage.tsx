import { type ReactElement, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { type DownloadLog } from 'src/shared/types'
import { useGalleryViewModel } from './useGalleryViewModel'
import { GalleryDetailPanel } from './GalleryDetailPanel'
import { GalleryToolbar, type GalleryViewMode } from './GalleryToolbar'
import { useGalleryFilter } from './useGalleryFilter'
import { GalleryMediaList } from './GalleryMediaList'
import { GalleryOverlays } from './GalleryOverlays'
import { DownloadLogModal } from './DownloadLogModal'

export const GalleryPage = (): ReactElement => {
    const [query, setQuery] = useState('')
    const [viewMode, setViewMode] = useState<GalleryViewMode>('grid')
    const [downloadLog, setDownloadLog] = useState<DownloadLog | null>(null)
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
    })

    if (isLoading && galleryItems.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
                <div className="flex flex-col items-center gap-2">
                    <FolderOpen size={28} strokeWidth={1.7} />
                    <p>미디어를 불러오는 중...</p>
                </div>
            </div>
        )
    }

    return (
        <div
            className="relative grid h-full min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden"
            onClick={clearSelection}
        >
            <section className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] px-5 pb-5 pt-[18px]">
                <header>
                    <h1 className="m-0 text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">
                        라이브러리
                    </h1>
                    <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">
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
                    onOpenDownloadLog={setDownloadLog}
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

            {downloadLog && (
                <DownloadLogModal log={downloadLog} onClose={() => setDownloadLog(null)} />
            )}
        </div>
    )
}
