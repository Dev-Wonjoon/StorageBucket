import { useState, useCallback, useEffect, useRef } from 'react'
import type { Media } from '../../../../shared/types'
import { getApi } from '@renderer/shared/api'
import { useMediaActions } from '@renderer/shared/hooks/useMediaActions'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'

interface FavoritesViewModel {
    galleryItems: Media[]
    selectedId: number | null
    isLoading: boolean
    toggleFavorite(id: number): Promise<void>
    deleteMedia(id: number): Promise<void>
    toggleSelect(id: number): void
}

export function useFavoritesViewModel(): FavoritesViewModel {
    const [medias, setMedias] = useState<Media[]>([])
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const requestId = useRef(0)
    const { mediaRevision } = useDownloadViewModel()
    const loadFavorites = useCallback(async (): Promise<void> => {
        const current = ++requestId.current
        setIsLoading(true)
        try {
            const items = await getApi().getFavorites()
            if (current === requestId.current)
                setMedias(items.map((item) => ({ ...item.media, isFavorite: true })))
        } catch (error) {
            if (current === requestId.current)
                console.error('[Favorites] Failed to load favorites:', error)
        } finally {
            if (current === requestId.current) setIsLoading(false)
        }
    }, [])
    useEffect(() => {
        const requests = requestId
        void loadFavorites()
        return () => {
            requests.current++
        }
    }, [loadFavorites, mediaRevision])
    const onDeleted = useCallback((id: number): void => {
        requestId.current++
        setIsLoading(false)
        setMedias((previous) => previous.filter((media) => media.id !== id))
        setSelectedId((previous) => (previous === id ? null : previous))
    }, [])
    const onFavoriteChanged = useCallback(
        (id: number, isFavorite: boolean): void => {
            if (!isFavorite) onDeleted(id)
        },
        [onDeleted]
    )
    const { toggleFavorite, deleteMedia } = useMediaActions({ onDeleted, onFavoriteChanged })
    return {
        galleryItems: medias,
        selectedId,
        isLoading,
        toggleFavorite,
        deleteMedia,
        toggleSelect: (id: number) => setSelectedId((previous) => (previous === id ? null : id))
    }
}
