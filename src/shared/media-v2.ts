export type MediaSourceKind = 'download' | 'local' | 'legacy'

export type MediaStorageKind = 'app_managed' | 'external_reference' | 'unverified_legacy'

export type MediaFileKind = 'image' | 'video' | 'audio' | 'unknown'

export type MediaErrorCode =
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT'
    | 'JOB_ACTIVE'
    | 'INVALID_COVER'
    | 'INVALID_LOCATION'
    | 'FILE_NOT_FOUND'
    | 'INVARIANT_VIOLATION'
    | 'INTERNAL_ERROR'
    | 'NOT_READY'

export type MediaResult<T> =
    | {
          ok: true
          data: T
      }
    | {
          ok: false
          error: {
              code: MediaErrorCode
              message: string
              context: Record<string, number>
          }
      }

export interface MediaFilter {
    keyword?: string
    tags?: string[]
    tagMode?: 'and' | 'or'
    platforms?: string[]
    authors?: string[]
    createdFrom?: number
    createdTo?: number
}

export interface MediaSuggestionRequest {
    kind: 'tag' | 'platform' | 'author'
    text: string
    limit?: number
}

export interface MediaListRequest {
    limit?: number
    offset?: number
    favoritesOnly?: boolean
    filter?: MediaFilter
}

export interface MediaGetRequest {
    mediaId: number
    fileLimit?: number
    fileOffset?: number
}

export interface MediaEditRequest {
    mediaId: number
    expectedRevision: number
    customTitle?: string | null
    cover?: { mode: 'auto' } | { mode: 'manual'; fileId: number }
    tagIds?: number[]
    tagChange?: {
        addNames?: string[]
        removeIds?: number[]
    }
    isFavorite?: boolean
}

export interface MediaUnregisterRequest {
    mediaId: number
    expectedRevision: number
}

export interface MediaUnregisterFilesRequest extends MediaUnregisterRequest {
    fileIds: number[]
}

export interface MediaSummaryDto {
    id: number
    sourceKind: MediaSourceKind
    requestUrl: string | null
    sourceTitle: string | null
    customTitle: string | null
    title: string
    revision: number
    coverMode: 'auto' | 'manual'
    cover: {
        fileId: number
        path: string
        kind: MediaFileKind
    } | null
    fileCount: number
    isFavorite: boolean
    createdAt: number
    updatedAt: number | null
}

export interface MediaFileDto {
    id: number
    mediaId: number
    fileKey: string
    storageKind: MediaStorageKind
    sourceUrl: string | null
    title: string | null
    filepath: string
    relativePath: string | null
    kind: MediaFileKind
    position: number
    filesize: number | null
    duration: number | null
    detectedFormat: string | null
    width: number | null
    height: number | null
    orientation: number | null
    frameCount: number | null
    pageCount: number | null
    primaryImageIndex: number | null
    thumbnailPath: string | null
    thumbnailOrigin: 'none' | 'app_generated' | 'unverified_legacy'
    previewPath: string | null
    createdAt: number
}

export interface MediaPage<T> {
    data: T[]
    total: number
    hasNextPage: boolean
}

export interface MediaDetailDto extends MediaSummaryDto {
    files: MediaPage<MediaFileDto>
    tags: {
        id: number
        name: string
    }[]
    favorite: {
        id: number
        createdAt: number
    } | null
    localFolder: {
        id: number
        sourceTitle: string
        revision: number
    } | null
    locations: {
        id: number
        directoryPath: string
        state: 'active' | 'reserved' | 'history'
    }[]
}

export interface MediaUnregisterResult {
    mediaId: number
    parentRemoved: boolean
    revision: number | null
    cleanupTaskId: string | null
}
