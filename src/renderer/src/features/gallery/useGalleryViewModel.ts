import { useState, useCallback, useEffect } from "react";
import { Media } from "src/shared/types";

export const useGalleryViewModel = () => {
    const [medias, setMedias] = useState<Media[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadMedia = useCallback(async () => {
        try {
            setIsLoading(true);
            const items = await window.electron.ipcRenderer.invoke('media:get-all');
            setMedias(items);
        } catch(error) {
            console.error('[GalleryViewModel] Failed to load media', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const toggleSelect = useCallback((id: number) => {
        setSelectedId(prev => prev === id ? null : id);
    }, []);

    useEffect(() => {
        loadMedia();

        const handleRefresh = () => {
            console.log('[GalleryViewModel] Refresh signal received.');
            loadMedia();
        };

        window.addEventListener('gallery-refresh', handleRefresh);
        return () => window.removeEventListener('gallery-refresh', handleRefresh);
    }, [loadMedia]);

    return {
        medias,
        selectedId,
        isLoading,
        toggleSelect,
        refresh: loadMedia
    };
};