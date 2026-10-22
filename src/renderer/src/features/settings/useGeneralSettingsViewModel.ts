import { useState, useEffect, useCallback } from 'react'
import { getApi } from '@renderer/shared/api'
import { useToast } from '@renderer/shared/hooks/useToast'

interface GeneralSettingsViewModel {
    downloadPath: string
    changePath(): Promise<void>
}
export function useGeneralSettingsViewModel(): GeneralSettingsViewModel {
    const [downloadPath, setDownloadPath] = useState('')
    const { showToast } = useToast()
    useEffect(() => {
        let cancelled = false
        getApi()
            .getDownloadPath()
            .then((value) => {
                if (!cancelled) setDownloadPath(value || '')
            })
            .catch((error: unknown) => {
                if (cancelled) return
                console.error('[Settings] Failed to load download path:', error)
                showToast('다운로드 경로를 읽지 못했습니다.', 'error')
            })
        return () => {
            cancelled = true
        }
    }, [showToast])
    const changePath = useCallback(async (): Promise<void> => {
        try {
            const value = await getApi().setDownloadPath()
            if (value) setDownloadPath(value)
        } catch (error) {
            console.error('[Settings] Failed to change download path:', error)
            showToast('다운로드 경로를 변경하지 못했습니다.', 'error')
        }
    }, [showToast])
    return { downloadPath, changePath }
}
