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
    'author_id',
    'channel_id',
    'username',
    'fullname',
    'uploader',
    'author',
    'channel',
    'user',
    'account',
    'name',
    'uploader_url',
    'author_url',
    'channel_url',
    'user_url',
    'profile_url',

    'post_id',
    'post_url',
    'shortcode',
    'tweet_id',
    'tweet_url',
    'conversation_id',
    'reddit_id',
    'submission_id',
    'blog_name',
    'deviation_id',
    'pixiv_id',
    'illust_id',
    'danbooru_id',

    'media_id',
    'sidecar_media_id',
    'image_id',
    'file_id',
    'id',

    'webpage_url',
    'url',
    'display_url',
    'video_url',
    'image_url',
    'file_url',
    'permalink',
    'link',
    'thumbnail',
    'preview',
    'preview_url',

    'filename',
    '_filename',
    'extension',
    'ext',
    'filesize',
    'file_size',
    'width',
    'height',

    'title',
    'description',
    'caption',
    'content',
    'text',
    'alt',
    'comment',

    'date',
    'post_date',
    'created_at',
    'created',
    'timestamp',
    'datetime',

    'tags',
    'tag_string',
    'rating',
    'score'
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
