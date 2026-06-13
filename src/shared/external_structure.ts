export type ExternalDownloader = 'yt-dlp' | 'gallery-dl'

export interface ExternalMediaStructure {
    downloader: ExternalDownloader
    site: string

    id?: string
    title?: string
    description?: string

    webpage_url?: string
    thumbnail?: string

    filename?: string
    extension?: string
    filesize?: number

    uploader?: string
    uploader_id?: string
    uploader_url?: string

    channel?: string
    channel_id?: string
}
