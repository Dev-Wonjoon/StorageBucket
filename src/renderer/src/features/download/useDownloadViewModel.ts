import { useState, useEffect, useMemo } from "react";
import { DownloadItem } from "./types";

export const useDownloadViewModel = () => {
    const [queue, setQueue] = useState<DownloadItem[]>([]);

    const activeItems = useMemo(() =>
        queue.filter(i => i.status === 'downloading' || i.status === 'pending'),
    [queue]);

    const totalProgress = useMemo(() => {
        if(activeItems.length === 0) return 0;
        return activeItems.reduce((acc, current) => acc + current.progress, 0) / activeItems.length;
    }, [activeItems]);

    const isDownloading = activeItems.length > 0;

    useEffect(() => {
        const removeListener = window.api.onDownloadProgress((data: any) => {
            setQueue(prev => prev.map(item => {
                if(item.id === data.url) {
                    return {
                        ...item,
                        progress: data.progress,
                        speed: data.speed,
                        eta: data.eta,
                        status: 'downloading',
                    };
                }
                return item;
            }));
        });
        return () => removeListener();
    }, []);

    const startDownload = async (url: string) => {
        const newItem: DownloadItem = {
            id: url,
            title: url,
            progress: 0,
            status: 'pending'
        };
        setQueue(prev => [newItem, ...prev]);

        try {
            const result = await window.api.downloadVideo(url);
            if(result.success) {
                setQueue(prev => prev.map(item => 
                    item.id === url
                        ? { ...item, progress: 100, status: 'completed', title: result.data.title }
                        : item
                ));
                window.dispatchEvent(new Event('gallery-refresh'));
            } else {
                throw new Error(result.error);
            }
        } catch(error) {
            setQueue(prev => prev.map(item =>
                item.id === url ? { ...item, status: 'error' } : item
            ));
        }
    };

    return {
        queue,
        activeCount: activeItems.length,
        totalProgress,
        isDownloading,
        startDownload
    }
}