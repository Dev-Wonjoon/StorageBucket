import { useState, useEffect, useMemo } from "react";
import { DownloadJob } from "src/shared/types";

export const useDownloadViewModel = () => {
    const [queue, setQueue] = useState<DownloadJob[]>([]);

    const [isPanelOpen, setIsPanelOpen] = useState(false);

    const activeItems = useMemo(() => 
        queue.filter(j => j.status === 'downloading' || j.status === 'pending'),
    [queue]);

    const activeCount = activeItems.length;
    const isDownloading = activeCount > 0;

    const totalProgress = useMemo(() => {
        if(activeCount === 0) return 0;
        const sum = activeItems.reduce((acc, current) => acc + (current.progress || 0), 0);
        return sum / activeCount;
    }, [activeItems, activeCount]);

    useEffect(() => {
        const removeListener = window.api.onQueueUpdate((updateQueue: DownloadJob[]) => {
            setQueue(updateQueue);

            const hasActiveJobs = updateQueue.some(
                job => job.status === 'downloading' || job.status === 'pending'
            );

            if(hasActiveJobs) {
                setIsPanelOpen(true);
            }
        });

        return () => removeListener();
    }, []);

    const startDownload = async (url: string) => {
        console.log('[ViewModel] Requesting download:', url);

        try {
            if(!window.api) {
                console.error('[Renderer] window.api is undefined.');
                return;
            }
            const result = await window.api.downloadVideo(url);

            if(!result.success) {
                console.error('Download Request Failed:', result.error);
                alert(`Download request failed: ${result.error}`);
            }
        } catch(error) {
            console.error('IPC Error:', error);
            alert('통신 중 오류가 발생했습니다.');
        }
    };

    const togglePanel = () => setIsPanelOpen(prev => !prev);

    return {
        queue,
        isPanelOpen,
        activeCount,
        totalProgress,
        isDownloading,
        startDownload,
        togglePanel
    };
};