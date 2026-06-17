import type { ExternalMediaStructure } from '../../../shared/external_structure'
import type { DownloadResultMetadata } from '../../../shared/types'
import type { GalleryDlRawMetadata } from '../../../shared/gallery_dl_raw_metadata'
import { firstValidText } from '../MetadataValue'
import { mergeGalleryDlFieldMap } from './GalleryDlFieldMap'

const pickRawValue = (raw: GalleryDlRawMetadata, field: string): unknown => {
    return field.split('.').reduce<unknown>((value, key) => {
        if(!value || typeof value !== 'object') return undefined

        return (value as Record<string, unknown>)[key]
    }, raw)
}

const pickText = (raw: GalleryDlRawMetadata, fields: readonly string[]): string | undefined => {
    for (const field of fields) {
        const value = pickRawValue(raw, field)

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

const truncateTitle = (value: string, maxLength = 100): string => {
    const text = value.replace(/\s+/g, ' ').trim()

    if(text.length <= maxLength) return text

    return `${text.slice(0, maxLength).trimEnd()}...`
}

const pickNumber = (raw: GalleryDlRawMetadata, fields: readonly string[]): number | undefined => {
    for (const field of fields) {
        const value = pickRawValue(raw, field)

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
    const title = firstValidText(item.title, item.description, item.filename, item.contentKey, item.fileKey, file) ?? file

    return {
        id: firstValidText(item.contentKey, item.fileKey, file) ?? file,
        title: truncateTitle(title),
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
