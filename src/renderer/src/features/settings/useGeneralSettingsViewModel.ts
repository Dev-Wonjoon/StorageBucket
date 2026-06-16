import { useState, useEffect, useCallback } from 'react'

export const useGeneralSettingsViewModel = () => {
    const [downloadPath, setDownloadPath] = useState('')

    const loadPath = useCallback(async () => {
        try {
            const path = await window.api.getDownloadPath()
            setDownloadPath(path || '')
        } catch (error) {
            console.error('[GeneralSettingsVM] Failed to load path:', error)
        }
    }, [])

    useEffect(() => {
        loadPath()
    }, [loadPath])

    const changePath = useCallback(async () => {
        try {
            const newPath = await window.api.setDownloadPath()
            if (newPath) setDownloadPath(newPath)
        } catch (error) {
            console.error('[GeneralSettingsVM] Failed to change path:', error)
        }
    }, [])

    return {
        downloadPath,
        changePath
    }
}
