import { type MouseEvent, type ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import { GalleryItem } from 'src/shared/types'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { GalleryViewMode } from './GalleryToolbar'
import { PhotoCard } from './PhotoCard'

interface GalleryMediaListProps {
    visibleItems: GalleryItem[]
    viewMode: GalleryViewMode
    selectedId: number | null
    selectedIds: Set<number>
    onSelect: (id: number, e: MouseEvent) => void
    onContextMenu: (e: MouseEvent, mediaId: number) => void
    onToggleFavorite: (id: number) => void
    onDelete: (id: number) => void
}

export const GalleryMediaList = ({
    visibleItems,
    viewMode,
    selectedId,
    selectedIds,
    onSelect,
    onContextMenu,
    onToggleFavorite,
    onDelete
}: GalleryMediaListProps): ReactElement => {
    return (
        <div className="min-h-0 overflow-auto pr-1">
            {visibleItems.length > 0 ? (
                <div
                    className={
                        viewMode === 'list'
                            ? 'grid gap-2'
                            : 'grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5'
                    }
                >
                    {visibleItems.map(({ media, isDownloading, progress, speed, eta }) => (
                        <PhotoCard
                            key={media.id}
                            data={media}
                            isSelected={selectedId === media.id || selectedIds.has(media.id)}
                            onClick={onSelect}
                            onContextMenu={onContextMenu}
                            onToggleFavorite={onToggleFavorite}
                            onDelete={onDelete}
                            isDownloading={isDownloading}
                            progress={progress}
                            speed={speed}
                            eta={eta}
                            layout={viewMode === 'list' ? 'list' : 'grid'}
                        />
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={<FolderOpen size={28} strokeWidth={1.7} />}
                    title="표시할 미디어가 없습니다"
                    description="URL을 붙여넣어 다운로드를 시작해보세요."
                />
            )}
        </div>
    )
}
