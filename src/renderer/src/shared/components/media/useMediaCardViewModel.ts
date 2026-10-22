import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import type { Media } from '../../../../../shared/types'
import { getApi } from '@renderer/shared/api'
import { useToast } from '@renderer/shared/hooks/useToast'
import { toMediaUrl, formatDuration } from '@renderer/shared/utils/media'

export function useMediaCardViewModel(data: Media): {
    imageUrl: string | null
    displayTime: string | null
    handleClick(onSelect: (id: number, event: MouseEvent) => void, event: MouseEvent): void
} {
    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const { showToast } = useToast()
    useEffect(
        () => () => {
            if (clickTimer.current) clearTimeout(clickTimer.current)
        },
        []
    )
    const openInFolder = useCallback(async (): Promise<void> => {
        if (!data.filepath) return
        try {
            await getApi().showItemInFolder(data.filepath)
        } catch (error) {
            console.error('[Media] Failed to show file:', error)
            showToast('파일 위치를 열지 못했습니다.', 'error')
        }
    }, [data.filepath, showToast])
    const handleClick = useCallback(
        (onSelect: (id: number, event: MouseEvent) => void, event: MouseEvent): void => {
            onSelect(data.id, event)
            if (clickTimer.current) {
                clearTimeout(clickTimer.current)
                clickTimer.current = null
                void openInFolder()
            } else {
                clickTimer.current = setTimeout(() => {
                    clickTimer.current = null
                }, 250)
            }
        },
        [data.id, openInFolder]
    )
    return {
        imageUrl: toMediaUrl(data.thumbnailPath),
        displayTime: formatDuration(data.duration),
        handleClick
    }
}
