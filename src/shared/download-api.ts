import type { DownloadOptions } from './types'

export type DownloadJobOptions = Pick<
    DownloadOptions,
    'type' | 'quality' | 'playlist' | 'extension'
>

export type DownloadState =
    'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export type DownloadPhase =
    'discovering' | 'downloading' | 'verifying' | 'committing' | 'rolling_back' | 'finished'

export type ManualDownloadTrigger = 'manual_initial' | 'manual_retry' | 'manual_restart'

export type DownloadResponse<T> =
    | {
          ok: true
          data: T
      }
    | {
          ok: false
          error: {
              code: string
              message: string
              context: Record<string, number>
          }
      }

export type DownloadEnqueueRequest = {
    url: string
    options?: DownloadJobOptions
} & (
    | {
          mode: 'create'
      }
    | {
          mode: 'replace'
          mediaId: number
          expectedRevision: number
      }
)

export interface DownloadJobDto {
    id: string
    url: string
    title: string | null
    state: DownloadState
    phase: DownloadPhase | null
    progress: number

    // null은 기존 옵션을 현재 실행기가 지원하지 않는 상태다.
    options: DownloadJobOptions | null

    cleanupRequired: boolean
    currentAttemptId: string | null
    errorCode: string | null
}

export interface DownloadPageDto {
    data: DownloadJobDto[]
    limit: number
    offset: number
    hasNextPage: boolean
}

export type DownloadRunDto =
    | {
          status: 'committed'
          jobId: string
          attemptId: string
          mediaIdSnapshot: number
      }
    | {
          status: 'cleanup_required'
          jobId: string
          attemptId: string
          taskId: string
      }
    | {
          status: 'blocked'
          jobId: string
          reason: string
      }

export interface DownloadApi {
    enqueue(request: DownloadEnqueueRequest): Promise<DownloadResponse<DownloadJobDto>>

    list(request?: { limit?: number; offset?: number }): Promise<DownloadResponse<DownloadPageDto>>

    get(request: { jobId: string }): Promise<DownloadResponse<DownloadJobDto>>

    run(request: {
        jobId: string
        trigger: ManualDownloadTrigger
    }): Promise<DownloadResponse<DownloadRunDto>>

    cancel(request: { jobId: string }): Promise<DownloadResponse<{ accepted: true }>>
}

export interface DownloadServicePort {
    enqueue(request: unknown): ReturnType<DownloadApi['enqueue']>
    list(request?: unknown): ReturnType<DownloadApi['list']>
    get(request: unknown): ReturnType<DownloadApi['get']>
    run(request: unknown): ReturnType<DownloadApi['run']>
    cancel(request: unknown): ReturnType<DownloadApi['cancel']>
}

export function downloadFailure(code: string): DownloadResponse<never> {
    const messages: Record<string, string> = {
        NOT_READY: '다운로드 기능을 사용할 준비가 되지 않았습니다.',
        INVALID_ARGUMENT: '다운로드 요청 값이나 옵션을 확인하세요.',
        NOT_FOUND: '다운로드 작업을 찾을 수 없습니다.',
        ALREADY_PROCESSING: '이미 처리 중인 작업이 있습니다.',
        REDOWNLOAD_CONFIRMATION_REQUIRED: '등록된 묶음의 교체 여부를 확인하세요.',
        REVISION_CONFLICT: '묶음 정보가 변경되었습니다. 새로고침 후 다시 확인하세요.',
        CLEANUP_REQUIRED: '이전 실행의 정리를 마친 후 다시 실행할 수 있습니다.',
        CANNOT_CANCEL_COMMITTING: '저장 중인 작업은 취소할 수 없습니다.',
        DATABASE_ERROR: '다운로드 DB 작업을 처리하지 못했습니다.',
        UNSUPPORTED_TARGET_DISCOVERY: '지원하지 않는 주소·옵션이거나 엔진 버전이 맞지 않습니다.',
        DOWNLOAD_ENGINE_FAILED: '다운로드 엔진 실행 환경을 확인하세요.',
        ENGINE_STOP_UNCONFIRMED: '엔진 종료 상태를 확인할 수 없어 실행을 보류했습니다.'
    }

    return {
        ok: false,
        error: {
            code,
            message: messages[code] ?? '다운로드 요청을 처리하지 못했습니다.',
            context: {}
        }
    }
}
