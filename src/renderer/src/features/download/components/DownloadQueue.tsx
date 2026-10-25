import { DOWNLOAD_PAGE_SIZE } from '../downloadStore'
import { useDownloadViewModel } from '../useDownloadViewModel'
import type { DownloadJobDto, ManualDownloadTrigger } from '../../../../../shared/download-api'

const states = {
    pending: '대기',
    running: '처리 중',
    completed: '완료',
    failed: '실패',
    cancelled: '취소됨',
    interrupted: '중단됨'
}

const phases = {
    discovering: '대상 확인 중',
    downloading: '다운로드 중',
    verifying: '파일 확인 중',
    committing: '저장 중',
    rolling_back: '정리 중',
    finished: '종료'
}

function trigger(job: DownloadJobDto): ManualDownloadTrigger | null {
    if (job.state === 'pending') {
        return 'manual_initial'
    }

    if (job.state === 'failed') {
        return 'manual_retry'
    }

    if (job.state === 'cancelled' || job.state === 'interrupted') {
        return 'manual_restart'
    }

    return null
}

export function DownloadQueue(): React.JSX.Element {
    const vm = useDownloadViewModel()

    const button =
        'rounded border border-[var(--border-line)] px-2 py-1 text-xs disabled:opacity-40'

    return (
        <details className="mb-5 rounded-xl border border-[var(--border-line)] p-3">
            <summary className="cursor-pointer text-sm font-medium">
                다운로드 작업
                {vm.requestedIds.length > 0
                    ? ' · 처리 중인 요청 ' + vm.requestedIds.length + '개'
                    : ''}
            </summary>

            <div className="mt-3 space-y-3">
                {vm.error && (
                    <p role="status" className="text-sm">
                        {vm.error.message}
                    </p>
                )}

                {vm.halted && (
                    <p role="alert" className="text-sm">
                        {vm.halted}
                    </p>
                )}

                <button className={button} disabled={vm.loading} onClick={() => void vm.refresh()}>
                    {vm.loading ? '조회 중' : '새로고침'}
                </button>

                {vm.ready && vm.queue.length === 0 && (
                    <p className="text-sm">등록된 작업이 없습니다.</p>
                )}

                <ul className="space-y-2">
                    {vm.queue.map((job) => {
                        const action = trigger(job)
                        const executing = vm.requestedIds.includes(job.id)
                        const cancelling = vm.cancellingIds.includes(job.id)

                        const canCancel =
                            (job.state === 'pending' || job.state === 'running') &&
                            job.phase !== 'committing' &&
                            !job.cleanupRequired

                        return (
                            <li
                                key={job.id}
                                className="rounded border border-[var(--border-line)] p-3 text-sm"
                            >
                                <p className="truncate">{job.title || job.url}</p>

                                <p className="text-[var(--text-muted)]">
                                    {states[job.state]}

                                    {job.state === 'running' && job.phase
                                        ? ' · ' + phases[job.phase]
                                        : ''}

                                    {executing && job.state === 'pending'
                                        ? ' · 실행 요청 대기'
                                        : ''}

                                    {job.cleanupRequired ? ' · 정리 필요' : ''}

                                    {job.options === null ? ' · 이전 옵션 확인 필요' : ''}
                                </p>

                                <div className="mt-2 flex gap-2">
                                    {action && (
                                        <button
                                            className={button}
                                            disabled={
                                                !vm.ready ||
                                                Boolean(vm.halted) ||
                                                executing ||
                                                cancelling ||
                                                job.cleanupRequired ||
                                                job.options === null
                                            }
                                            onClick={() => vm.runJob(job.id, action)}
                                        >
                                            {action === 'manual_initial'
                                                ? '실행'
                                                : action === 'manual_retry'
                                                  ? '재시도'
                                                  : '다시 시작'}
                                        </button>
                                    )}

                                    {canCancel && (
                                        <button
                                            className={button}
                                            disabled={!vm.ready || cancelling}
                                            onClick={() => vm.cancelDownload(job.id)}
                                        >
                                            {cancelling ? '취소 요청 중' : '취소 요청'}
                                        </button>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>

                <nav aria-label="다운로드 작업 페이지" className="flex items-center gap-3">
                    <button
                        className={button}
                        disabled={vm.loading || vm.offset === 0}
                        onClick={() => void vm.refresh(Math.max(0, vm.offset - DOWNLOAD_PAGE_SIZE))}
                    >
                        이전
                    </button>

                    <span className="text-sm">
                        {Math.floor(vm.offset / DOWNLOAD_PAGE_SIZE) + 1}
                        {' 페이지'}
                    </span>

                    <button
                        className={button}
                        disabled={vm.loading || !vm.hasNextPage}
                        onClick={() => void vm.refresh(vm.offset + DOWNLOAD_PAGE_SIZE)}
                    >
                        다음
                    </button>
                </nav>
            </div>
        </details>
    )
}
