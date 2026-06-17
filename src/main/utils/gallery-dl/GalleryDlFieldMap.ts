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
    contentKey: ['_archive', 'archive', 'archive_id', 'post_id', 'id'],
    contentUrl: ['webpage_url', 'post_url', 'tweet_url', 'permalink', 'link', 'url'],
    fileKey: ['media_id', 'sidecar_media_id', 'image_id', 'file_id', 'id'],
    filename: ['filename', '_filename'],
    extension: ['extension', 'ext'],
    filesize: ['filesize', 'file_size'],
    ownerKey: ['owner_id', 'user_id', 'uploader_id', 'author_id', 'channel_id', 'user.id'],
    ownerName: [
        'username',
        'fullname',
        'uploader',
        'author',
        'channel',
        'user.nick',
        'user.name',
        'user.screen_name',
        'user',
        'account',
        'name'
    ],
    ownerUrl: ['uploader_url', 'author_url', 'channel_url', 'user_url', 'profile_url'],
    thumbnailUrl: ['thumbnail', 'preview', 'preview_url', 'display_url'],
    mediaUrl: ['video_url', 'image_url', 'file_url', 'display_url', 'url'],
    title: ['title', 'description', 'caption', 'content', 'text'],
    description: ['description', 'caption', 'content', 'text', 'comment', 'alt'],
    date: ['date', 'post_date', 'created_at', 'created', 'timestamp', 'datetime']
}

const GALLERY_DL_EXTRACTOR_FIELD_MAP: Partial<Record<string, Partial<GalleryDlFieldMap>>> = {
    twitter: {
        contentKey: ['tweet_id', 'conversation_id', 'post_id'],
        contentUrl: ['tweet_url', 'post_url'],
        fileKey: ['media_id', 'id'],
        ownerKey: ['user_id', 'owner_id'],
        ownerName: ['username', 'fullname', 'author'],
        title: ['content', 'text', 'description'],
        description: ['content', 'text', 'description']
    },
    instagram: {
        contentKey: ['post_id', 'shortcode'],
        contentUrl: ['post_url', 'webpage_url'],
        fileKey: ['sidecar_media_id', 'media_id', 'id'],
        ownerKey: ['owner_id', 'user_id'],
        ownerName: ['username', 'fullname'],
        title: ['caption', 'description'],
        description: ['caption', 'description']
    },
    pixiv: {
        contentKey: ['illust_id', 'pixiv_id', 'id'],
        contentUrl: ['post_url', 'webpage_url'],
        fileKey: ['image_id', 'file_id', 'id'],
        ownerKey: ['user_id', 'owner_id', 'author_id'],
        ownerName: ['user', 'username', 'author', 'fullname'],
        ownerUrl: ['user_url', 'author_url'],
        title: ['title', 'caption', 'description'],
        description: ['description', 'caption', 'comment']
    },
    danbooru: {
        contentKey: ['danbooru_id', 'post_id', 'id'],
        contentUrl: ['post_url', 'webpage_url'],
        fileKey: ['md5', 'file_id', 'id'],
        ownerKey: ['uploader_id', 'owner_id'],
        ownerName: ['uploader', 'author'],
        mediaUrl: ['file_url', 'large_file_url', 'url'],
        thumbnailUrl: ['preview_url', 'thumbnail'],
        title: ['tag_string', 'title'],
        description: ['tag_string', 'description']
    },
    reddit: {
        contentKey: ['submission_id', 'reddit_id', 'id'],
        contentUrl: ['permalink', 'post_url', 'webpage_url'],
        fileKey: ['media_id', 'id'],
        ownerName: ['author', 'username'],
        title: ['title', 'selftext', 'description'],
        description: ['selftext', 'description', 'caption']
    },
    tumblr: {
        contentKey: ['post_id', 'id'],
        contentUrl: ['post_url', 'webpage_url'],
        fileKey: ['media_id', 'id'],
        ownerName: ['blog_name', 'username', 'name'],
        title: ['summary', 'title', 'caption'],
        description: ['caption', 'summary', 'description']
    },
    deviantart: {
        contentKey: ['deviation_id', 'id'],
        contentUrl: ['deviation_url', 'webpage_url', 'url'],
        fileKey: ['media_id', 'id'],
        ownerName: ['author', 'username'],
        ownerUrl: ['author_url', 'user_url'],
        title: ['title'],
        description: ['description', 'caption']
    }
}

const mergeFields = (base: readonly string[], override?: readonly string[]): readonly string[] => {
    if (!override) return base

    return [...override, ...base.filter((field) => !override.includes(field))]
}

const normalizeExtractorKey = (extractor: string): string => {
    const key = extractor.toLowerCase()

    if (key === 'x') return 'twitter'

    return key
}

export const mergeGalleryDlFieldMap = (extractor: string): GalleryDlFieldMap => {
    const key = normalizeExtractorKey(extractor)
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
