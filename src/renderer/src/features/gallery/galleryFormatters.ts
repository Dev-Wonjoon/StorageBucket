import { Media } from 'src/shared/types'

export const formatBytes = (bytes?: number | null): string => {
    if (!bytes || bytes <= 0) return '알 수 없음'

    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    let value = bytes
    let unit = 0

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }

    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export const getImageUrl = (media?: Media | null): string | null => {
    if (!media?.thumbnailPath) return null
    return `media:///${media.thumbnailPath.replace(/\\/g, '/')}`
}
