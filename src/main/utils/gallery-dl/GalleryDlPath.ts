import path from 'path'
import type { GalleryDlRawMetadata } from '../../../shared/gallery_dl_raw_metadata'
import { extractSiteKey } from '../ArgsUtils'
import { firstValidText, safeFileStem, safePathSegment } from '../MetadataValue'

export const buildGalleryDlDownloadedFilePath = (
    basePath: string,
    info: GalleryDlRawMetadata,
    url: string
): string => {
    const category = safePathSegment(
        firstValidText(info.category, extractSiteKey(url)),
        'unknown-site'
    )
    const ownerId = safePathSegment(
        firstValidText(info.owner_id, info.username, info.fullname, info.uploader),
        'unknown-owner'
    )
    const filename = safeFileStem(
        firstValidText(info.filename, info.media_id, info.sidecar_media_id, info.id),
        'unknown'
    )
    const mediaId = safeFileStem(firstValidText(info.media_id, info.sidecar_media_id), '')
    const extension = safeFileStem(info.extension, 'jpg')

    const outputName = mediaId ? `${mediaId}_${filename}.${extension}` : `${filename}.${extension}`

    return path.join(basePath, category, ownerId, outputName)
}
