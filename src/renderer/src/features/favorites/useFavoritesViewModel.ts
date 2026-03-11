import { useState, useCallback, useEffect } from "react";
import { Media } from "src/shared/types";

export const useFavoritesViewModel = () => {
    const [medias, setMedias] = useState<Media[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadFavorites = useCallback(async () => {
        try {
            setIsLoading(true);
            const items = await window.electron.ipcRenderer.invoke('favorite:get-all');
            setMedias(items.map((item: any) => ({ ...item.media, isFavorite: true})));
        } catch(error) {
            console.error('[FavoritesViewModel] Failed to load favorites', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const toggleSelect = useCallback((id: number) => {
        setSelectedId(prev => prev === id ? null : id);
    }, []);

    const toggleFavorite = useCallback(async (id: number) => {
        await window.electron.ipcRenderer.invoke('favorite:toggle', id);
        setMedias(prev => prev.filter(m => m.id !== id));
    }, []);

    const deleteMedia = useCallback(async (id: number) => {
        const confirmed = window.confirm('정말 삭제하시겠습니까?');
        if(!confirmed) return;

        await window.electron.ipcRenderer.invoke('media:delete', id);
        setMedias(prev => prev.filter(m => m.id !== id));
    }, []);

    useEffect(() => {
        loadFavorites();
    }, [loadFavorites]);

    return {
        galleryItems: medias,
        selectedId,
        isLoading,
        toggleSelect,
        toggleFavorite,
        deleteMedia,
    };
};