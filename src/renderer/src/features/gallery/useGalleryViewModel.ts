import { useState, useCallback, useEffect, useRef, useMemo, type MouseEvent } from 'react'
import type { Media } from '../../../../shared/types'
import type { GalleryItem } from './types'
import { getApi } from '@renderer/shared/api'
import { useMediaActions } from '@renderer/shared/hooks/useMediaActions'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'

interface GalleryViewModel {
    galleryItems: GalleryItem[]
    medias: Media[]
    selectedId: number | null
    selectedIds: Set<number>
    contextMenu: { x: number; y: number; mediaId: number } | null
    tagModal: { mediaIds: number[] } | null
    isLoading: boolean
    toggleSelect(id: number): void
    toggleFavorite(id: number): Promise<void>
    deleteMedia(id: number): Promise<void>
    refresh(): Promise<void>
    handleSelect(id: number, event: MouseEvent): void
    selectAll(): void
    clearSelection(): void
    handleContextMenu(event: MouseEvent, mediaId: number): void
    closeContextMenu(): void
    openTagModal(mediaIds: number[]): void
    closeTagModal(): void
}

export function useGalleryViewModel(): GalleryViewModel {
    const [medias, setMedias] = useState<Media[]>([])
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [isLoading, setIsLoading] = useState(true)
    const lastClickedId = useRef<number | null>(null)
    const requestId = useRef(0)
    const [contextMenu, setContextMenu] = useState<{
        x: number
        y: number
        mediaId: number
    } | null>(null)
    const [tagModal, setTagModal] = useState<{ mediaIds: number[] } | null>(null)
    const { queue, mediaRevision } = useDownloadViewModel()

    const galleryItems = useMemo<GalleryItem[]>(
        () => [
            ...queue
                .filter((job) => job.status === 'pending' || job.status === 'downloading')
                .map((job, index) => ({
                    media: {
                        id: -(index + 1),
                        title: job.title || job.url,
                        filepath: '',
                        thumbnailPath: null,
                        platformId: null,
                        profileId: null,
                        createdAt: new Date(0),
                        updatedAt: new Date(0)
                    },
                    isDownloading: true,
                    progress: job.progress,
                    downloadId: job.id
                })),
            ...medias.map((media) => ({ media, isDownloading: false }))
        ],
        [medias, queue]
    )

    const loadMedia = useCallback(async (): Promise<void> => {
        const current = ++requestId.current
        setIsLoading(true)
        try {
            const items = await getApi().getMediaFiles()
            if (current === requestId.current) setMedias(items)
        } catch (error) {
            if (current === requestId.current)
                console.error('[Gallery] Failed to load media:', error)
        } finally {
            if (current === requestId.current) setIsLoading(false)
        }
    }, [])
    useEffect(() => {
        const requests = requestId
        void loadMedia()
        return () => {
            requests.current++
        }
    }, [loadMedia, mediaRevision])

    const onDeleted = useCallback((id: number): void => {
        // Invalidate older list requests so they cannot restore a deleted item.
        requestId.current++
        setIsLoading(false)
        setMedias((previous) => previous.filter((media) => media.id !== id))
        setSelectedId((previous) => (previous === id ? null : previous))
        setSelectedIds((previous) => {
            const next = new Set(previous)
            next.delete(id)
            return next
        })
    }, [])
    const onFavoriteChanged = useCallback((id: number, isFavorite: boolean): void => {
        requestId.current++
        setIsLoading(false)
        setMedias((previous) =>
            previous.map((media) => (media.id === id ? { ...media, isFavorite } : media))
        )
    }, [])
    const { toggleFavorite, deleteMedia } = useMediaActions({ onDeleted, onFavoriteChanged })

    const toggleSelect = useCallback((id: number): void => {
        setSelectedId((previous) => (previous === id ? null : id))
    }, [])
    const handleSelect = useCallback(
        (id: number, event: MouseEvent): void => {
            if (event.ctrlKey || event.metaKey) {
                setSelectedIds((previous) => {
                    const next = new Set(previous)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                })
                setSelectedId(null)
            } else if (event.shiftKey && lastClickedId.current !== null) {
                const ids = medias.map((media) => media.id)
                const start = ids.indexOf(lastClickedId.current)
                const end = ids.indexOf(id)
                if (start !== -1 && end !== -1) {
                    const range = ids.slice(Math.min(start, end), Math.max(start, end) + 1)
                    setSelectedIds((previous) => new Set([...previous, ...range]))
                }
                setSelectedId(null)
            } else {
                setSelectedIds(new Set())
                toggleSelect(id)
            }
            lastClickedId.current = id
        },
        [medias, toggleSelect]
    )

    return {
        galleryItems,
        medias,
        selectedId,
        selectedIds,
        contextMenu,
        tagModal,
        isLoading,
        toggleSelect,
        toggleFavorite,
        deleteMedia,
        refresh: loadMedia,
        handleSelect,
        selectAll: () => {
            setSelectedIds(new Set(medias.map((media) => media.id)))
            setSelectedId(null)
        },
        clearSelection: () => {
            setSelectedIds(new Set())
            setSelectedId(null)
        },
        handleContextMenu: (event: MouseEvent, mediaId: number) => {
            event.preventDefault()
            setContextMenu({ x: event.clientX, y: event.clientY, mediaId })
        },
        closeContextMenu: () => setContextMenu(null),
        openTagModal: (mediaIds: number[]) => setTagModal({ mediaIds }),
        closeTagModal: () => setTagModal(null)
    }
}
