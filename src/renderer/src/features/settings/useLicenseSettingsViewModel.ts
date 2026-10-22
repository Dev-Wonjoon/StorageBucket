import { getApi } from '@renderer/shared/api'
import type { LicenseInfo } from '../../../../shared/types'
import { useCallback, useEffect, useState } from 'react'

export const useLicenseSettingsViewModel = (): {
    licenses: LicenseInfo[]
    expanded: string | null
    toggle(name: string): void
} => {
    const [licenses, setLicenses] = useState<LicenseInfo[]>([])
    const [expanded, setExpanded] = useState<string | null>(null)

    useEffect(() => {
        getApi()
            .getEngineLicenses()
            .then(setLicenses)
            .catch((error) => {
                console.error('[LicenseSettingsVM] Failed to fetch licenses:', error)
            })
    }, [])

    const toggle = useCallback((name: string) => {
        setExpanded((prev) => (prev === name ? null : name))
    }, [])

    return {
        licenses,
        expanded,
        toggle
    }
}
