import { useEffect } from 'react'
import { ListDetailLayout } from '@renderer/shared/components/layout/ListDetailLayout'
import { useDownloadViewModel } from './useDownloadViewModel'
import { DownloadQueue } from './components/DownloadQueue'
import { DownloadDetailPane } from './components/DownloadDetailPane'

export function DownloadPage(): React.JSX.Element | null {
    const vm = useDownloadViewModel()
    const { closeDetail } = vm
    useEffect(() => () => closeDetail(), [closeDetail])
    return (
        <ListDetailLayout
            detailLabel="다운로드 상세"
            detailKey={vm.detail.jobId}
            onClose={vm.closeDetail}
            detail={vm.detail.jobId !== null ? <DownloadDetailPane /> : undefined}
        >
            <div className="space-y-5">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-lg font-semibold">다운로드</h1>
                        <p className="mt-1 text-sm text-[var(--text-muted)]">
                            작업 상태를 확인하고 취소하거나 다시 실행하세요.
                        </p>
                    </div>
                    <button
                        type="button"
                        disabled={vm.loading}
                        onClick={() => void vm.refresh()}
                        className="rounded-lg border border-[var(--border-line)] px-3 py-2 text-sm disabled:opacity-40"
                    >
                        {vm.loading ? '조회 중' : '새로고침'}
                    </button>
                </header>
                <DownloadQueue />
            </div>
        </ListDetailLayout>
    )
}
