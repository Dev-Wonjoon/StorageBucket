import type {
    DownloadJobOptions,
    DownloadTargetInput,
    DownloadResultInput
} from '../repositories/DownloadRepository'

export interface DownloadAttemptContext {
    jobId: string
    attemptId: string
    stagingDirectory: string
}

export interface FrozenDownloadTarget extends Readonly<DownloadTargetInput> {
    readonly id: string
    readonly position: number
    readonly metadata: Readonly<DownloadTargetInput['metadata']>
}

export interface DownloadWorkspacePort {
    // 외부 요청 전에 비밀 정보 없는 초기 실행 기록을 영속화하고 전용 staging을 준비한다.
    prepare(context: Readonly<DownloadAttemptContext>): Promise<void>
}

export interface FrozenDownloadAdapter {
    // resolve/reject는 시작한 모든 자식 프로세스의 종료 후에만 수행한다.
    discover(
        input: Readonly<DownloadAttemptContext> & {
            originalUrl: string
            options: Readonly<DownloadJobOptions>
            signal: AbortSignal
        }
    ): Promise<readonly DownloadTargetInput[]>

    // 원 요청 URL을 재추출하지 않고 DB에서 고정한 대상만 실행한다.
    downloadFrozen(
        input: Readonly<DownloadAttemptContext> & {
            targets: readonly FrozenDownloadTarget[]
            options: Readonly<DownloadJobOptions>
            signal: AbortSignal
        }
    ): Promise<readonly DownloadResultInput[]>
}

// 프로세스나 네트워크 요청을 실행하지 않는 선택 함수다.
export type DownloadAdapterSelector = (
    originalUrl: string,
    options: Readonly<DownloadJobOptions>
) => FrozenDownloadAdapter | undefined
