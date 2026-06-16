import { useMemo, useCallback, useRef } from 'react'
import { Media } from 'src/shared/types'

interface PhotoCardViewModel {
    imageUrl: string | null
    displayTime: string | null
    hasThumbnail: boolean
    handleClick: (onSelect: (id: number, e: React.MouseEvent) => void, e: React.MouseEvent) => void
}

export const usePhotoCardViewModel = (data: Media): PhotoCardViewModel => {
    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const imageUrl = useMemo(() => {
        if (!data.thumbnailPath) return null

        const cleanPath = data.thumbnailPath.replace(/\\/g, '/')
        return `media:///${cleanPath}`
    }, [data.thumbnailPath])

    const displayTime = useMemo(() => {
        const seconds = data.duration
        if (!seconds || seconds <= 0 || isNaN(seconds)) return null
        const m = Math.floor(seconds / 60)
        const s = Math.floor(seconds % 60)
        return `${m}:${s.toString().padStart(2, '0')}`
    }, [data.duration])

    const hasThumbnail = Boolean(data.thumbnailPath)

    const openInFolder = useCallback(() => {
        if (!data.filepath) return
        if (!window.api?.showItemInFolder) return
        void window.api.showItemInFolder(data.id)
    }, [data.filepath])

    const handleClick = useCallback(
        (onSelect: (id: number, e: React.MouseEvent) => void, e: React.MouseEvent) => {
            onSelect(data.id, e)

            if (clickTimer.current) {
                clearTimeout(clickTimer.current)
                clickTimer.current = null
                openInFolder()
            } else {
                clickTimer.current = setTimeout(() => {
                    clickTimer.current = null
                }, 250)
            }
        },
        [data.id, openInFolder]
    )

    return {
        imageUrl,
        displayTime,
        hasThumbnail,
        handleClick
    }
}
