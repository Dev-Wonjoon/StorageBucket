import { useMemo, useCallback, useRef } from "react";
import { Media } from "src/shared/types";

export const usePhotoCardViewModel = (data: Media) => {

    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const imageUrl = useMemo(() => {
        if(!data.thumbnailPath) return null;

        const cleanPath = data.thumbnailPath.replace(/\\/g, '/');
        return `media:///${cleanPath}`;
    }, [data.thumbnailPath]);

    const displayTime = useMemo(() => {
        const seconds = data.duration;
        if(!seconds || seconds <= 0 || isNaN(seconds)) return null;
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }, [data.duration]);

    const hasThumbnail = Boolean(data.thumbnailPath);

    const openInFolder = useCallback(() => {
        if(!data.filepath) return;
        window.electron.ipcRenderer.invoke('shell:show-item', data.filepath);
    }, [data.filepath]);

    const handleClick = useCallback((onSelect: (id: number) => void) => {
        if(clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
            openInFolder();
        } else {
            clickTimer.current = setTimeout(() => {
                clickTimer.current = null;
                onSelect(data.id);
            }, 250);
        }
    }, [data.id, openInFolder]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();

        console.log('[PhotoCard] Context menu requested for:', data.id);
    }, [data.id]);

    return {
        imageUrl,
        displayTime,
        hasThumbnail,
        handleClick,
        handleContextMenu,
    };
};