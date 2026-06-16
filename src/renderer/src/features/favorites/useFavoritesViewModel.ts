import { useState, useCallback, useEffect } from 'react'
import { Media } from 'src/shared/types'

interface FavoriteRow {
    media: Media
}

interface FavoritesViewModel {
    galleryItems: Media[]
    selectedId: number | null
    isLoading: boolean
    toggleSelect: (id: number) => void
    toggleFavorite: (id: number) => Promise<void>
    deleteMedia: (id: number) => Promise<void>
}

export const useFavoritesViewModel = (): FavoritesViewModel => {
    const [medias, setMedias] = useState<Media[]>([])
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    const loadFavorites = useCallback(async () => {
        try {
            setIsLoading(true)
            if (!window.api?.getFavorites) {
                setMedias([])
                return
            }
            const items = await window.api.getFavorites()
            setMedias(items.map((item: FavoriteRow) => ({ ...item.media, isFavorite: true })))
        } catch (error) {
            console.error('[FavoritesViewModel] Failed to load favorites', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const toggleSelect = useCallback((id: number) => {
        setSelectedId((prev) => (prev === id ? null : id))
    }, [])

    const toggleFavorite = useCallback(async (id: number) => {
        if (!window.api?.toggleFavorite) return
        await window.api.toggleFavorite(id)
        setMedias((prev) => prev.filter((m) => m.id !== id))
    }, [])

    const deleteMedia = useCallback(async (id: number) => {
        const confirmed = window.confirm('정말 삭제하시겠습니까?')
        if (!confirmed) return

        if (!window.api?.deleteMedia) return
        await window.api.deleteMedia(id)
        setMedias((prev) => prev.filter((m) => m.id !== id))
    }, [])

    useEffect(() => {
        loadFavorites()
    }, [loadFavorites])

    return {
        galleryItems: medias,
        selectedId,
        isLoading,
        toggleSelect,
        toggleFavorite,
        deleteMedia
    }
}
