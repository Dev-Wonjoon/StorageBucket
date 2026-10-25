import type {
    MediaDetailDto,
    MediaEditRequest,
    MediaErrorCode,
    MediaFileDto,
    MediaPage,
    MediaResult,
    MediaSummaryDto,
    MediaUnregisterResult
} from '../../shared/media-v2'
import {
    MediaRepositoryError,
    type MediaRepository,
    type PagedMediaDetail,
    type MediaSummary
} from '../repositories/MediaRepository'

const messages: Record<MediaErrorCode, string> = {
    INVALID_ARGUMENT: '요청 값이 올바르지 않습니다.',
    NOT_FOUND: '미디어를 찾을 수 없습니다.',
    REVISION_CONFLICT: '다른 변경이 반영되었습니다. 새로고침 후 다시 시도하세요.',
    JOB_ACTIVE: '작업이 진행 중이거나 정리가 필요합니다.',
    INVALID_COVER: '이 묶음에 속한 파일을 표지로 선택하세요.',
    INVALID_LOCATION: '유효한 원본 위치가 아닙니다.',
    FILE_NOT_FOUND: '이 묶음에서 제거할 파일을 찾을 수 없습니다.',
    INVARIANT_VIOLATION: '저장된 데이터 상태를 확인해야 합니다.',
    INTERNAL_ERROR: '미디어 요청을 처리하지 못했습니다.',
    NOT_READY: '미디어 기능을 사용할 준비가 되지 않았습니다.'
}

type Input = Record<string, unknown>

function invalid(): never {
    throw new MediaRepositoryError('INVALID_ARGUMENT')
}

function object(value: unknown, allowed: string[]): Input {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid()
    }

    const prototype = Object.getPrototypeOf(value)

    if (prototype !== Object.prototype && prototype !== null) {
        invalid()
    }

    const input = value as Input

    if (Object.keys(input).some((key) => !allowed.includes(key))) {
        invalid()
    }

    return input
}

function integer(value: unknown, min = Number.MIN_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
        invalid()
    }

    return value
}

function ids(value: unknown): number[] {
    if (!Array.isArray(value)) invalid()

    return [...new Set(Array.from(value, (item) => integer(item)))]
}

function page(limitValue: unknown, offsetValue: unknown) {
    const limit = limitValue === undefined ? 50 : integer(limitValue, 1)

    const offset = offsetValue === undefined ? 0 : integer(offsetValue, 0)

    if (limit > 200 || !Number.isSafeInteger(limit + offset)) {
        invalid()
    }

    return { limit, offset }
}

function reference(input: Input) {
    return {
        mediaId: integer(input.mediaId),
        expectedRevision: integer(input.expectedRevision, 0)
    }
}

function editRequest(value: unknown): MediaEditRequest {
    const input = object(value, [
        'mediaId',
        'expectedRevision',
        'customTitle',
        'cover',
        'tagIds',
        'tagChange',
        'isFavorite'
    ])

    const request: MediaEditRequest = reference(input)

    if (input.customTitle !== undefined) {
        if (input.customTitle !== null && typeof input.customTitle !== 'string') {
            invalid()
        }

        request.customTitle = input.customTitle
    }

    if (input.cover !== undefined) {
        const cover = object(input.cover, ['mode', 'fileId'])

        if (cover.mode === 'auto') {
            if ('fileId' in cover) invalid()
            request.cover = { mode: 'auto' }
        } else if (cover.mode === 'manual') {
            request.cover = {
                mode: 'manual',
                fileId: integer(cover.fileId)
            }
        } else {
            invalid()
        }
    }

    if (input.tagIds !== undefined && input.tagChange !== undefined) {
        invalid()
    }

    if (input.tagIds !== undefined) {
        request.tagIds = ids(input.tagIds)
    }

    if (input.tagChange !== undefined) {
        const change = object(input.tagChange, ['addNames', 'removeIds'])

        let addNames: string[] = []

        if (change.addNames !== undefined) {
            if (!Array.isArray(change.addNames)) {
                invalid()
            }

            addNames = [
                ...new Set(
                    Array.from(change.addNames, (name) => {
                        if (typeof name !== 'string' || !name.trim()) {
                            invalid()
                        }

                        return name.trim()
                    })
                )
            ]
        }

        const removeIds = change.removeIds === undefined ? [] : ids(change.removeIds)

        if (!addNames.length && !removeIds.length) {
            invalid()
        }

        request.tagChange = {
            addNames,
            removeIds
        }
    }

    if (input.isFavorite !== undefined) {
        if (typeof input.isFavorite !== 'boolean') {
            invalid()
        }

        request.isFavorite = input.isFavorite
    }

    if (
        request.customTitle === undefined &&
        request.cover === undefined &&
        request.tagIds === undefined &&
        request.tagChange === undefined &&
        request.isFavorite === undefined
    ) {
        invalid()
    }

    return request
}

function summary(value: MediaSummary): MediaSummaryDto {
    return {
        id: value.media.id,
        sourceKind: value.media.sourceKind,
        requestUrl: value.requestUrl,
        sourceTitle: value.media.sourceTitle,
        customTitle: value.media.customTitle,
        title: value.displayTitle,
        revision: value.media.revision,
        coverMode: value.media.coverMode,
        cover: value.cover ? { ...value.cover } : null,
        fileCount: value.fileCount,
        isFavorite: value.isFavorite,
        createdAt: value.media.createdAt,
        updatedAt: value.media.updatedAt
    }
}

function child(value: PagedMediaDetail['files']['data'][number]): MediaFileDto {
    return {
        id: value.id,
        mediaId: value.mediaId,
        fileKey: value.fileKey,
        storageKind: value.storageKind,
        sourceUrl: value.sourceUrl,
        title: value.title,
        filepath: value.filepath,
        relativePath: value.relativePath,
        kind: value.kind,
        position: value.position,
        filesize: value.filesize,
        duration: value.duration,
        detectedFormat: value.detectedFormat,
        width: value.width,
        height: value.height,
        orientation: value.orientation,
        frameCount: value.frameCount,
        pageCount: value.pageCount,
        primaryImageIndex: value.primaryImageIndex,
        thumbnailPath: value.thumbnailPath,
        thumbnailOrigin: value.thumbnailOrigin,
        previewPath: value.previewPath,
        createdAt: value.createdAt
    }
}

function detail(value: PagedMediaDetail): MediaDetailDto {
    return {
        ...summary(value),
        files: {
            ...value.files,
            data: value.files.data.map(child)
        },
        tags: value.tags.map((tag) => ({ ...tag })),
        favorite: value.favorite
            ? {
                  id: value.favorite.id,
                  createdAt: value.favorite.createdAt
              }
            : null,
        localFolder: value.localFolder
            ? {
                  id: value.localFolder.id,
                  sourceTitle: value.localFolder.sourceTitle,
                  revision: value.localFolder.revision
              }
            : null,
        locations: value.locations.map((location) => ({
            id: location.id,
            directoryPath: location.directoryPath,
            state: location.state
        }))
    }
}

export class MediaService {
    constructor(
        private readonly repository: MediaRepository,
        private readonly reportUnexpected: (error: unknown) => void = (error) =>
            console.error('[MediaService]', error)
    ) {}

    list(request: unknown = {}): MediaResult<MediaPage<MediaSummaryDto>> {
        return this.execute(() => {
            const input = object(request, ['limit', 'offset', 'favoritesOnly', 'filter'])

            if (input.favoritesOnly !== undefined && typeof input.favoritesOnly !== 'boolean') {
                invalid()
            }

            const result = this.repository.list({
                ...page(input.limit, input.offset),
                favoritesOnly: input.favoritesOnly ?? false,
                filter: input.filter
            })

            return {
                ...result,
                data: result.data.map(summary)
            }
        })
    }

    suggest(request: unknown): MediaResult<string[]> {
        return this.execute(() => {
            const input = object(request, ['kind', 'text', 'limit'])

            if (input.kind !== 'tag' && input.kind !== 'platform' && input.kind !== 'author') {
                invalid()
            }

            if (typeof input.text !== 'string' || input.text.length > 200) {
                invalid()
            }

            const limit = input.limit === undefined ? 10 : integer(input.limit, 1)

            if (limit > 20) invalid()

            return this.repository.suggest({
                kind: input.kind,
                text: input.text,
                limit
            })
        })
    }

    get(request: unknown): MediaResult<MediaDetailDto> {
        return this.execute(() => {
            const input = object(request, ['mediaId', 'fileLimit', 'fileOffset'])

            const mediaId = integer(input.mediaId)

            const { limit, offset } = page(input.fileLimit, input.fileOffset)

            const result = this.repository.getPage(mediaId, { limit, offset })

            if (!result) {
                throw new MediaRepositoryError('NOT_FOUND', { mediaId })
            }

            return detail(result)
        })
    }

    // 편집 후에는 부모 요약을 반환한다.
    // 자식 페이지는 get으로 조회한다.
    edit(request: unknown): MediaResult<MediaSummaryDto> {
        return this.execute(() => {
            const { mediaId, expectedRevision, ...changes } = editRequest(request)

            return summary(this.repository.edit(mediaId, expectedRevision, changes))
        })
    }

    unregisterFiles(request: unknown): MediaResult<MediaUnregisterResult> {
        return this.execute(() => {
            const input = object(request, ['mediaId', 'expectedRevision', 'fileIds'])

            const { mediaId, expectedRevision } = reference(input)

            const fileIds = ids(input.fileIds)

            if (!fileIds.length) invalid()

            return this.repository.unregisterFiles(mediaId, expectedRevision, fileIds)
        })
    }

    unregisterMedia(request: unknown): MediaResult<MediaUnregisterResult> {
        return this.execute(() => {
            const input = object(request, ['mediaId', 'expectedRevision'])

            const { mediaId, expectedRevision } = reference(input)

            return this.repository.unregisterMedia(mediaId, expectedRevision)
        })
    }

    private execute<T>(action: () => T): MediaResult<T> {
        try {
            return {
                ok: true,
                data: action()
            }
        } catch (error) {
            if (error instanceof MediaRepositoryError) {
                const context: Record<string, number> = {}

                for (const key of ['mediaId', 'expectedRevision', 'actualRevision']) {
                    const value = error.context[key]

                    if (typeof value === 'number' && Number.isSafeInteger(value)) {
                        context[key] = value
                    }
                }

                return {
                    ok: false,
                    error: {
                        code: error.code,
                        message: messages[error.code],
                        context
                    }
                }
            }

            try {
                this.reportUnexpected(error)
            } catch {
                // 로깅 실패가 오류 응답을 막지 않게 한다.
            }

            return {
                ok: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: messages.INTERNAL_ERROR,
                    context: {}
                }
            }
        }
    }
}
