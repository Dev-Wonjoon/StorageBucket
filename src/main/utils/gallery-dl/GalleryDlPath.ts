import path from 'path';
import type { InstagramStructure } from '../../../shared/instagram_structure';
import { extractSiteKey } from '../ArgsUtils';

export const buildGalleryDlDownloadedFilePath = (
    basePath: string,
    info: Partial<InstagramStructure>,
    url: string
): string => {
    const category = info.category || extractSiteKey(url);
    const ownerId = info.owner_id || 'unknown';
    const filename = info.filename || info.media_id || info.shortcode || 'unknown';
    const extension = info.extension || 'jpg';
    const outputName = info.media_id
        ? `${info.media_id}_${filename}.${extension}`
        : `${filename}.${extension}`;

    return path.join(basePath, category, ownerId, outputName);

}