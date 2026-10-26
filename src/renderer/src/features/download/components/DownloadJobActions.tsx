import type { DownloadJobDto } from '../../../../../shared/download-api'
import { useDownloadViewModel } from '../useDownloadViewModel'
import { canCancelDownload, downloadTrigger } from '../downloadPresentation'

export function DownloadJobActions({ job }: { job: DownloadJobDto }): React.JSX.Element | null {
    const vm = useDownloadViewModel()
    const action = downloadTrigger(job)
    const executing = vm.requestedIds.includes(job.id)
    const cancelling = vm.cancellingIds.includes(job.id)
    const button =
        'rounded-lg border border-[var(--border-line)] bg-[var(--bg-sidebar)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)] disabled:opacity-40'
    return (
        <>
            {action && !(job.state === 'pending' && executing) && (
                <button
                    type="button"
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
                    {executing
                        ? '실행 요청 중'
                        : action === 'manual_initial'
                          ? '실행'
                          : action === 'manual_retry'
                            ? '재시도'
                            : '다시 시작'}
                </button>
            )}
            {canCancelDownload(job) && (
                <button
                    type="button"
                    className={button}
                    disabled={!vm.ready || cancelling}
                    onClick={() => vm.cancelDownload(job.id)}
                >
                    {cancelling ? '취소 요청 중' : '취소 요청'}
                </button>
            )}
        </>
    )
}
