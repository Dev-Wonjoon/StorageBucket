import { type MouseEvent, type ReactElement } from "react";
import { FolderOpen } from "lucide-react";
import { GalleryItem } from "src/shared/types";
import { GalleryViewMode } from "./GalleryToolbar";
import { PhotoCard } from "./PhotoCard";

interface GalleryMediaListProps {
    visibleItems: GalleryItem[];
    viewMode: GalleryViewMode;
    selectedId: number | null;
    selectedIds: Set<number>;
    onSelect: (id: number, e: MouseEvent) => void;
    onContextMenu: (e: MouseEvent, mediaId: number) => void;
    onToggleFavorite: (id: number) => void;
    onDelete: (id: number) => void;
}

export const GalleryMediaList = ({
    visibleItems,
    viewMode,
    selectedId,
    selectedIds,
    onSelect,
    onContextMenu,
    onToggleFavorite,
    onDelete,
}: GalleryMediaListProps): ReactElement => {
        return (
        <div className="sb-gallery-scroll">
            {visibleItems.length > 0 ? (
                <div className={viewMode === 'list' ? 'sb-media-list' : 'sb-media-grid'}>
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
                <div className="sb-empty-state">
                    <FolderOpen size={28} strokeWidth={1.7} />
                    <p className="mt-3 text-lg font-semibold text-[var(--text-main)]">
                        표시할 미디어가 없습니다
                    </p>
                    <p className="mt-1 text-sm">URL을 붙여넣어 다운로드를 시작해보세요.</p>
                </div>
            )}
        </div>
    )
}