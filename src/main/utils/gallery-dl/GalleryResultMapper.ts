import path from 'path';
import type { DownloadResultMetadata } from '../../../shared/types';
import type { InstagramStructure } from '../../../shared/instagram_structure';
import { extractSiteKey } from '../ArgsUtils';

export const mapGalleryDlInstagramMetadata = (
    info: Partial<InstagramStructure>,
    file: string,
    url: string,
    filesize: number
): DownloadResultMetadata => {
    const uploaderId =
        info.owner_id ||
        info.username ||
        'unknown';

    const uploaderName =
        info.username ||
        info.fullname ||
        uploaderId;

    const title =
        info.shortcode ||
        info.media_id ||
        info.filename ||
        path.basename(file, path.extname(file));

    return {
        id: String(info.media_id || info.post_id || info.shortcode || path.basename(file)),
        title,
        extractor_key: extractSiteKey(url),
        filename: file,
        filesize,
        uploader: uploaderName,
        uploader_id: uploaderId,
        webpage_url: info.post_url || url,
        thumbnail: info.display_url,
    };
}