import type { GalleryDlRawMetadata } from '../../../shared/gallery_dl_raw_metadata'
import { firstValidText } from '../MetadataValue'

export const GALLERY_DL_PRINT_PREFIX = 'STORAGEBUCKET_META'

const GALLERY_DL_PRINT_FIELDS = [
    'extractor',
    'category',
    'subcategory',
    '_archive',
    'archive',
    'archive_id',
    'owner_id',
    'user_id',
    'uploader_id',
    'username',
    'fullname',
    'uploader',
    'uploader_url',
    'post_id',
    'post_url',
    'shortcode',
    'tweet_id',
    'tweet_url',
    'conversation_id',
    'media_id',
    'sidecar_media_id',
    'id',
    'webpage_url',
    'url',
    'display_url',
    'video_url',
    'thumbnail',
    'filename',
    'extension',
    'filesize',
    'title',
    'description',
    'caption',
    'date',
    'post_date'
] as const

export const buildGalleryDlPrintFormat = (): string => {
    return [GALLERY_DL_PRINT_PREFIX, ...GALLERY_DL_PRINT_FIELDS.map((field) => `{${field}}`)].join(
        '\t'
    )
}

export const parseGalleryDlPrintMetadata = (line: string): GalleryDlRawMetadata | null => {
    if (!line.startsWith(`${GALLERY_DL_PRINT_PREFIX}\t`)) return null

    const [, ...values] = line.split('\t')
    const metadata: GalleryDlRawMetadata = {}

    GALLERY_DL_PRINT_FIELDS.forEach((field, index) => {
        const value = firstValidText(values[index])

        if (value) {
            metadata[field] = value
        }
    })

    return metadata
}
