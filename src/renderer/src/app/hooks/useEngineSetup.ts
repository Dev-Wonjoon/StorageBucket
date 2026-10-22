import { useEffect, useState } from 'react'
import { getApi } from '@renderer/shared/api'
import { useToast } from '@renderer/shared/hooks/useToast'

export function useEngineSetup(): { showSetup: boolean; closeSetup(): void } {
    const [showSetup, setShowSetup] = useState(false)
    const { showToast } = useToast()
    useEffect(() => {
        let cancelled = false
        getApi()
            .getEngineStatus()
            .then((status) => {
                if (!cancelled)
                    setShowSetup(Object.values(status).some((engine) => !engine.installed))
            })
            .catch((error: unknown) => {
                if (cancelled) return
                console.error('[EngineSetup] Failed to load engine status:', error)
                showToast('엔진 상태를 확인하지 못했습니다.', 'error')
            })
        return () => {
            cancelled = true
        }
    }, [showToast])
    return { showSetup, closeSetup: () => setShowSetup(false) }
}
