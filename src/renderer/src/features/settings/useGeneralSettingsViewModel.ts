import { useState, useEffect, useCallback } from "react";

export const useGeneralSettingsViewModel = () => {
    const [downloadPath, setDownloadPath] = useState('');

    const loadPath = useCallback(async () => {
        try {
            const path = await window.electron.ipcRenderer.invoke('get-download-path');
            setDownloadPath(path || '');
        } catch(error) {
            console.error('[GeneralSettingsVM] Failed to load path:', error);
        }
    }, []);

    useEffect(() => {
        loadPath();
    }, [loadPath]);

    const changePath = useCallback(async () => {
        try {
            const newPath = await window.electron.ipcRenderer.invoke('set-download-path');
            if(newPath) setDownloadPath(newPath);
        } catch(error) {
            console.error('[GeneralSettingsVM] Failed to change path:', error);
        }
    }, []);

    return {
        downloadPath,
        changePath,
    }
}