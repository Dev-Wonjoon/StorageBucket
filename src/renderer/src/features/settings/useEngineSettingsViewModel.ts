import { getApi } from '@renderer/shared/api'
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@renderer/shared/hooks/useToast'
import { EngineStatus } from '../../../../shared/types'

export const useEngineSettingsViewModel = (): {
    engines: Record<string, EngineStatus>
    installing: string | null
    loading: boolean
    install(engine: string): Promise<void>
} => {
    const [engines, setEngines] = useState<Record<string, EngineStatus>>({})
    const [installing, setInstalling] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const { showToast } = useToast()

    const fetchStatus = useCallback(async () => {
        try {
            const status = await getApi().getEngineStatus()
            setEngines(status)
        } catch (error) {
            console.error('[EngineSettingsVM] Failed to fetch status:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchStatus()
    }, [fetchStatus])

    const install = useCallback(
        async (engine: string) => {
            setInstalling(engine)

            try {
                const success = await getApi().installEngine(engine)

                if (!success) {
                    showToast(`${engine} 설치에 실패했습니다. 다시 시도해 주세요.`, 'error')
                    return
                }

                await fetchStatus()
            } catch (error) {
                console.error(`[EngineSettingsVM] Failed to install ${engine}:`, error)
                showToast(`${engine} 설치 요청을 처리하지 못했습니다.`, 'error')
            } finally {
                setInstalling(null)
            }
        },
        [fetchStatus, showToast]
    )

    return {
        engines,
        installing,
        loading,
        install
    }
}
