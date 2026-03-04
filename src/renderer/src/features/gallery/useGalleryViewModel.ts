import { useState, useCallback, useEffect } from "react";
import { Media, DownloadItem, GalleryItem } from "src/shared/types";

const hashStringToNumber = (str: string): number => 
    Math.abs(str.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 0)) || Date.now();

const jobToPlaceholder = (item: DownloadItem): Media => ({
    id: -hashStringToNumber(item.id),
    title: item.title || item.url || item.id || 'Downloading...',
    filepath: '',
    thumbnailPath: null,
    duration: 0,
    filesize: 0,
    platformId: null,
    profileId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    author: '',
    platform: '',
    url: item.url || null,
});

export const useGalleryViewModel = () => {
    const [medias, setMedias] = useState<Media[]>([]);
    const [downloadQueue, setDownloadQueue] = useState<DownloadItem[]>([]);
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

    useEffect(() => {
        const removeListener = window.api.onQueueUpdate((updateQueue: DownloadItem[]) => {
            setDownloadQueue(updateQueue);
        });

        return () => removeListener?.();
    }, []);

    const galleryItems: GalleryItem[] = [
        ...downloadQueue
            .filter(item => item.status === 'downloading' || item.status === 'pending')
            .map(item => ({
                media: jobToPlaceholder(item),
                isDownloading: true,
                progress: item.progress,
                speed: item.speed,
                eta: item.eta,
                downloadId: item.id
            })),
        ...medias.map(media => ({
            media,
            isDownloading: false,
        })),
    ];

    return {
        galleryItems,
        medias,
        selectedId,
        isLoading,
        toggleSelect,
        refresh: loadMedia,
    };
};