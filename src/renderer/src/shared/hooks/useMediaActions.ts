import { useCallback } from 'react'
import { getApi } from '../api'
import { useToast } from './useToast'

interface MediaActionCallbacks {
    onDeleted(id: number): void
    onFavoriteChanged(id: number, isFavorite: boolean): void
}

export interface MediaActions {
    toggleFavorite(id: number): Promise<void>
    deleteMedia(id: number): Promise<void>
}

export function useMediaActions({
    onDeleted,
    onFavoriteChanged
}: MediaActionCallbacks): MediaActions {
    const { showToast } = useToast()
    const toggleFavorite = useCallback(
        async (id: number): Promise<void> => {
            try {
                const favorite = await getApi().toggleFavorite(id)
                onFavoriteChanged(id, favorite)
            } catch (error) {
                console.error('[Media] Failed to toggle favorite:', error)
                showToast('즐겨찾기를 변경하지 못했습니다.', 'error')
            }
        },
        [onFavoriteChanged, showToast]
    )

    const deleteMedia = useCallback(
        async (id: number): Promise<void> => {
            if (!window.confirm('정말 삭제하시겠습니까?')) return
            try {
                await getApi().deleteMedia(id)
                onDeleted(id)
            } catch (error) {
                console.error('[Media] Failed to delete media:', error)
                showToast('미디어를 삭제하지 못했습니다.', 'error')
            }
        },
        [onDeleted, showToast]
    )
    return { toggleFavorite, deleteMedia }
}
