import { useMemo } from "react";
import { GalleryItem } from "src/shared/types";
import { GalleryViewMode } from "./GalleryToolbar";

interface UseGalleryFilterParams {
    galleryItems: GalleryItem[];
    query: string;
    viewMode: GalleryViewMode;
    selectedId: number | null;
    selectedIds: Set<number>;
}

export const useGalleryFilter = ({
    galleryItems,
    query,
    viewMode,
    selectedId,
    selectedIds
}: UseGalleryFilterParams) => {
    const visibleItems = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        const source =
            viewMode === 'queue' ? galleryItems.filter((item) => item.isDownloading) : galleryItems

        if(!keyword) return source;

        return source.filter(({ media }) => {
            return [media.title, media.author, media.platform, media.url, media.filepath]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(keyword));
        });
    }, [galleryItems, query, viewMode]);

    const selectedMedia = useMemo(() => {
        if(selectedId === null) return null;

        const selected = galleryItems.find(
            (item) => item.media.id === selectedId && !item.isDownloading
        )

        return selected?.media ?? null;
    }, [galleryItems, selectedId])

    const selectedCount = selectedIds.size + (selectedId ? 1 : 0)

    const activeDownloads = useMemo(() => {
        return galleryItems.filter((item) => item.isDownloading).length
    }, [galleryItems]);

    return {
        visibleItems,
        selectedMedia,
        selectedCount,
        activeDownloads,
    }
}