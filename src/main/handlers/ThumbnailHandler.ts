import type { IpcMainInvokeEvent } from 'electron'
import type {
    ThumbnailErrorCode,
    ThumbnailRequest,
    ThumbnailResult,
    ThumbnailStatusDto
} from '../../shared/thumbnail-api'
import type { DownloadThumbnailRepository } from '../repositories/DownloadThumbnailRepository'

type Repository = Pick<DownloadThumbnailRepository, 'getStatus' | 'retryFailed'>

type Result = ThumbnailResult<ThumbnailStatusDto>

function failure(code: ThumbnailErrorCode, message: string): Extract<Result, { ok: false }> {
    return {
        ok: false,
        error: { code, message }
    }
}

function parseRequest(value: unknown): ThumbnailRequest | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }

    const request = value as Record<string, unknown>
    const keys = Object.keys(request)

    if (
        keys.length !== 2 ||
        !keys.includes('mediaId') ||
        !keys.includes('fileId') ||
        typeof request.mediaId !== 'number' ||
        !Number.isSafeInteger(request.mediaId) ||
        request.mediaId <= 0 ||
        typeof request.fileId !== 'number' ||
        !Number.isSafeInteger(request.fileId) ||
        request.fileId <= 0
    ) {
        return null
    }

    return {
        mediaId: request.mediaId,
        fileId: request.fileId
    }
}

export function createThumbnailHandlers(
    resolveRepository: () => Repository | undefined,
    reportUnexpected: (error: unknown) => void = (error) =>
        console.error('[ThumbnailHandler]', error)
) {
    function execute(
        value: unknown,
        action: (repository: Repository, request: ThumbnailRequest) => Result
    ): Result {
        try {
            const request = parseRequest(value)

            if (!request) {
                return failure('INVALID_ARGUMENT', '올바른 미디어와 파일을 선택해 주세요.')
            }

            const repository = resolveRepository()

            if (!repository) {
                return failure('NOT_READY', '썸네일 기능을 사용할 준비가 되지 않았습니다.')
            }

            return action(repository, request)
        } catch (error) {
            try {
                reportUnexpected(error)
            } catch {
                // 오류 보고 실패가 응답을 바꾸지 않게 한다.
            }

            return failure('INTERNAL_ERROR', '썸네일 요청을 처리하지 못했습니다.')
        }
    }

    return {
        'thumbnail:get': async (_event: IpcMainInvokeEvent, value: unknown): Promise<Result> =>
            execute(value, (repository, request) => {
                const status = repository.getStatus(request.mediaId, request.fileId)

                return status
                    ? { ok: true, data: status }
                    : failure('NOT_FOUND', '대상 파일을 찾을 수 없습니다.')
            }),

        'thumbnail:retry': async (_event: IpcMainInvokeEvent, value: unknown): Promise<Result> =>
            execute(value, (repository, request) => {
                // renderer가 보낸 작업 ID 대신 현재 파일의 작업을 main에서 찾는다.
                const status = repository.getStatus(request.mediaId, request.fileId)

                if (!status) {
                    return failure('NOT_FOUND', '대상 파일을 찾을 수 없습니다.')
                }

                if (!status.canRetry || !status.taskId) {
                    return failure(
                        'NOT_RETRYABLE',
                        '현재 상태에서는 썸네일을 다시 시도할 수 없습니다.'
                    )
                }

                const result = repository.retryFailed(status.taskId)

                if (!result.accepted) {
                    switch (result.reason) {
                        case 'source_busy':
                            return failure(
                                'SOURCE_BUSY',
                                '재다운로드가 끝난 뒤 다시 시도해 주세요.'
                            )

                        case 'source_changed':
                            return failure(
                                'SOURCE_CHANGED',
                                '파일 정보가 변경되었습니다. 상세 정보를 다시 확인해 주세요.'
                            )

                        case 'not_retryable':
                            return failure(
                                'NOT_RETRYABLE',
                                '현재 상태에서는 썸네일을 다시 시도할 수 없습니다.'
                            )
                    }
                }

                return {
                    ok: true,
                    data: {
                        state: 'pending',
                        taskId: status.taskId,
                        canRetry: false
                    }
                }
            })
    }
}
