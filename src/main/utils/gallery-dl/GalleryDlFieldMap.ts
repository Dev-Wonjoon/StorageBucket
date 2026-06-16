export type GalleryDlFieldMap = {
    contentKey: readonly string[]
    contentUrl: readonly string[]
    fileKey: readonly string[]
    filename: readonly string[]
    extension: readonly string[]
    filesize: readonly string[]
    ownerKey: readonly string[]
    ownerName: readonly string[]
    ownerUrl: readonly string[]
    thumbnailUrl: readonly string[]
    mediaUrl: readonly string[]
    title: readonly string[]
    description: readonly string[]
    date: readonly string[]
}

export const DEFAULT_GALLERY_DL_FIELD_MAP: GalleryDlFieldMap = {
    contentKey: ['_archive', 'archive', 'archive_id'],
    contentUrl: ['webpage_url', 'post_url', 'tweet_url', 'url'],
    fileKey: ['media_id', 'sidecar_media_id', 'id'],
    filename: ['filename', '_filename'],
    extension: ['extension', 'ext'],
    filesize: ['filesize', 'file_size'],
    ownerKey: ['owner_id', 'user_id', 'uploader_id', 'channel_id'],
    ownerName: ['username', 'fullname', 'uploader', 'author', 'channel'],
    ownerUrl: ['uploader_url', 'channel_url', 'user_url'],
    thumbnailUrl: ['thumbnail', 'display_url'],
    mediaUrl: ['video_url', 'display_url', 'url'],
    title: ['title'],
    description: ['description', 'caption'],
    date: ['date', 'post_date', 'created_at']
}

const GALLERY_DL_EXTRACTOR_FIELD_MAP: Partial<Record<string, Partial<GalleryDlFieldMap>>> = {
    twitter: {
        contentKey: ['tweet_id', 'conversation_id'],
        contentUrl: ['tweet_url']
    },
    instagram: {
        contentKey: ['post_id', 'shortcode'],
        contentUrl: ['post_url']
    }
}

const mergeFields = (base: readonly string[], override?: readonly string[]): readonly string[] => {
    if (!override) return base

    return [...override, ...base.filter((field) => !override.includes(field))]
}

export const mergeGalleryDlFieldMap = (extractor: string): GalleryDlFieldMap => {
    const key = extractor.toLowerCase()
    const override = GALLERY_DL_EXTRACTOR_FIELD_MAP[key] ?? {}

    return {
        contentKey: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.contentKey, override.contentKey),
        contentUrl: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.contentUrl, override.contentUrl),
        fileKey: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.fileKey, override.fileKey),
        filename: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.filename, override.filename),
        extension: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.extension, override.extension),
        filesize: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.filesize, override.filesize),
        ownerKey: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.ownerKey, override.ownerKey),
        ownerName: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.ownerName, override.ownerName),
        ownerUrl: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.ownerUrl, override.ownerUrl),
        thumbnailUrl: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.thumbnailUrl, override.thumbnailUrl),
        mediaUrl: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.mediaUrl, override.mediaUrl),
        title: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.title, override.title),
        description: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.description, override.description),
        date: mergeFields(DEFAULT_GALLERY_DL_FIELD_MAP.date, override.date)
    }
}
