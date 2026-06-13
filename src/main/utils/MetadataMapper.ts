import type { DownloadResultMetadata } from '../../shared/types'
import type { InstagramStructure } from '../../shared/instagram_structure'

export function mapInstagramMetadata(
    info: Partial<InstagramStructure>,
    url: string,
    file: string,
    filesize: number
): DownloadResultMetadata {
    const uploaderId = info.owner_id || info.username || 'unknown'
    const uploaderName = info.fullname || info.username || uploaderId

    return {
        id: String(info.media_id || info.post_id || info.shortcode || file),
        title: info.description || info.shortcode || info.media_id || file,
        extractor_key: 'instagram',
        filename: file,
        filesize,
        uploader: uploaderName,
        uploader_id: uploaderId,
        webpage_url: info.post_url || url,
        thumbnail: info.display_url
    }
}
