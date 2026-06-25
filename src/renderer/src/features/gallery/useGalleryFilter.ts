import { useMemo } from 'react'
import { GalleryItem } from 'src/shared/types'
import { GallerySortMode, GalleryViewMode } from './GalleryToolbar'

interface UseGalleryFilterParams {
    galleryItems: GalleryItem[]
    query: string
    viewMode: GalleryViewMode
    sortMode: GallerySortMode
    selectedId: number | null
    selectedIds: Set<number>
}

export const useGalleryFilter = ({
    galleryItems,
    query,
    viewMode,
    sortMode,
    selectedId,
    selectedIds
}: UseGalleryFilterParams) => {
    const visibleItems = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        const source =
            viewMode === 'queue' ? galleryItems.filter((item) => item.downloadStatus) : galleryItems

        const filteredItems = keyword
            ? source.filter(({ media }) => {
                  return [media.title, media.author, media.platform, media.url, media.filepath]
                      .filter(Boolean)
                      .some((value) => String(value).toLowerCase().includes(keyword))
              })
            : source

        return [...filteredItems].sort((a, b) => {
            if (sortMode === 'titleAsc') {
                return a.media.title.localeCompare(b.media.title, 'ko-KR')
            }

            return new Date(b.media.createdAt).getTime() - new Date(a.media.createdAt).getTime()
        })
    }, [galleryItems, query, sortMode, viewMode])

    const selectedMedia = useMemo(() => {
        if (selectedId === null) return null

        const selected = galleryItems.find(
            (item) => item.media.id === selectedId && !item.downloadStatus
        )

        return selected?.media ?? null
    }, [galleryItems, selectedId])

    const selectedCount = selectedIds.size + (selectedId ? 1 : 0)

    const activeDownloads = useMemo(() => {
        return galleryItems.filter(
            (item) => item.downloadStatus === 'pending' || item.downloadStatus === 'downloading'
        ).length
    }, [galleryItems])

    return {
        visibleItems,
        selectedMedia,
        selectedCount,
        activeDownloads
    }
}
