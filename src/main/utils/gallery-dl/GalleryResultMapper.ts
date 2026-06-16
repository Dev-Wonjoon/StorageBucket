import type { ExternalMediaStructure } from '../../../shared/external_structure'
import type { DownloadResultMetadata } from '../../../shared/types'
import type { GalleryDlRawMetadata } from '../../../shared/gallery_dl_raw_metadata'
import { firstValidText } from '../MetadataValue'
import { mergeGalleryDlFieldMap } from './GalleryDlFieldMap'

const pickText = (raw: GalleryDlRawMetadata, fields: readonly string[]): string | undefined => {
    for (const field of fields) {
        const value = raw[field]

        if (typeof value === 'string') {
            const text = firstValidText(value)
            if (text) return text
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value)
        }
    }

    return undefined
}

const pickNumber = (raw: GalleryDlRawMetadata, fields: readonly string[]): number | undefined => {
    for (const field of fields) {
        const value = raw[field]

        if (typeof value === 'number' && Number.isFinite(value)) {
            return value
        }

        if (typeof value === 'string') {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) return parsed
        }
    }

    return undefined
}

export const mapGalleryDlMetadata = (
    raw: GalleryDlRawMetadata,
    sourceUrl: string
): ExternalMediaStructure => {
    const extractor = pickText(raw, ['extractor', 'category']) ?? 'unknown'
    const site = pickText(raw, ['category', 'site', 'extractor']) ?? extractor
    const fieldMap = mergeGalleryDlFieldMap(extractor)

    return {
        downloader: 'gallery-dl',
        extractor,
        site,

        sourceUrl,

        contentKey: pickText(raw, fieldMap.contentKey),
        contentUrl: pickText(raw, fieldMap.contentUrl),

        fileKey: pickText(raw, fieldMap.fileKey),
        filename: pickText(raw, fieldMap.filename),
        extension: pickText(raw, fieldMap.extension),
        filesize: pickNumber(raw, fieldMap.filesize),

        ownerKey: pickText(raw, fieldMap.ownerKey),
        ownerName: pickText(raw, fieldMap.ownerName),
        ownerUrl: pickText(raw, fieldMap.ownerUrl),

        thumbnailUrl: pickText(raw, fieldMap.thumbnailUrl),
        mediaUrl: pickText(raw, fieldMap.mediaUrl),

        title: pickText(raw, fieldMap.title),
        description: pickText(raw, fieldMap.description),
        date: pickText(raw, fieldMap.date),

        raw
    }
}

export const mapExternalMediaToDownloadMetadata = (
    item: ExternalMediaStructure,
    file: string,
    filesize: number
): DownloadResultMetadata => {
    return {
        id: firstValidText(item.contentKey, item.fileKey, file) ?? file,
        title: firstValidText(item.title, item.contentKey, item.filename, file) ?? file,
        extractor_key: item.extractor,
        filename: file,
        filesize,
        uploader: item.ownerName,
        uploader_id: item.ownerKey,
        uploader_url: item.ownerUrl,
        webpage_url: firstValidText(item.contentUrl, item.sourceUrl) ?? item.sourceUrl,
        thumbnail: item.thumbnailUrl
    }
}
