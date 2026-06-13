import type { InstagramStructure } from '../../../shared/instagram_structure'

export const GALLERY_DL_PRINT_PREFIX = 'STORAGEBUCKET_META'

const normalizePrintedValue = (value?: string): string | undefined => {
    if (!value || value == 'None' || value == 'null' || value === 'undefined') {
        return undefined
    }

    return value
}

export const buildGalleryDlPrintFormat = (): string => {
    return [
        GALLERY_DL_PRINT_PREFIX,
        '{category}',
        '{owner_id}',
        '{username}',
        '{fullname}',
        '{post_id}',
        '{media_id}',
        '{shortcode}',
        '{post_url}',
        '{display_url}',
        '{filename}',
        '{extension}'
    ].join('\t')
}

export const parseGalleryDlPrintMetadata = (line: string): Partial<InstagramStructure> | null => {
    if (!line.startsWith(`${GALLERY_DL_PRINT_PREFIX}\t`)) return null

    const [
        ,
        category,
        owner_id,
        username,
        fullname,
        post_id,
        media_id,
        shortcode,
        post_url,
        display_url,
        filename,
        extension
    ] = line.split('\t')

    return {
        category: normalizePrintedValue(category),
        owner_id: normalizePrintedValue(owner_id),
        username: normalizePrintedValue(username),
        fullname: normalizePrintedValue(fullname),
        post_id: normalizePrintedValue(post_id),
        media_id: normalizePrintedValue(media_id),
        shortcode: normalizePrintedValue(shortcode),
        post_url: normalizePrintedValue(post_url),
        display_url: normalizePrintedValue(display_url),
        filename: normalizePrintedValue(filename),
        extension: normalizePrintedValue(extension)
    }
}
