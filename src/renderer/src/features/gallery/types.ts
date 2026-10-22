import type { Media } from '../../../../shared/types'

export interface GalleryItem {
    media: Media
    isDownloading: boolean
    progress?: number
    downloadId?: string
}
