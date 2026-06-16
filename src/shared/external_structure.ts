export type ExternalDownloader = 'yt-dlp' | 'gallery-dl'

export interface ExternalMediaStructure {
    downloader: ExternalDownloader
    extractor: string
    site: string

    sourceUrl: string

    contentKey?: string
    contentUrl?: string

    fileKey?: string
    filename?: string
    extension?: string
    filesize?: number

    ownerKey?: string
    ownerName?: string
    ownerUrl?: string

    thumbnailUrl?: string
    mediaUrl?: string

    title?: string
    description?: string
    date?: string

    raw?: Record<string, unknown>
}
