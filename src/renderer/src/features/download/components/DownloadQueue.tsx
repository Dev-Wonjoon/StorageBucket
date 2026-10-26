import { DOWNLOAD_PAGE_SIZE } from '../downloadStore'
import { useDownloadViewModel } from '../useDownloadViewModel'
import { downloadPlatform, downloadStatus, visibleProgress } from '../downloadPresentation'
import { DownloadJobActions } from './DownloadJobActions'
import { DownloadThumbnail } from './DownloadThumbnail'

export function DownloadQueue(): React.JSX.Element {
    const vm = useDownloadViewModel()
    const button =
        'rounded-lg border border-[var(--border-line)] px-3 py-2 text-sm disabled:opacity-40'
    return (
        <section aria-label="다운로드 작업 목록" className="space-y-4">
            {vm.error && <p role="alert">{vm.error.message}</p>}
            {vm.halted && <p role="alert">{vm.halted}</p>}
            {!vm.ready && !vm.error && <p role="status">작업 목록을 불러오는 중...</p>}
            {vm.ready && vm.queue.length === 0 && (
                <p className="py-16 text-center text-[var(--text-muted)]">
                    등록된 작업이 없습니다. 상단에 링크를 붙여넣어 다운로드하세요.
                </p>
            )}
            <ul className="space-y-3">
                {vm.queue.map((job) => {
                    const selected = vm.detail.jobId === job.id
                    const progress = visibleProgress(job)
                    return (
                        <li
                            key={job.id}
                            className={
                                'flex items-start gap-4 rounded-xl border bg-[var(--bg-sidebar)] p-4 ' +
                                (selected
                                    ? 'border-[var(--color-primary)]'
                                    : 'border-[var(--border-line)]')
                            }
                        >
                            <DownloadThumbnail />
                            <div className="min-w-0 flex-1 space-y-2">
                                <p className="truncate text-sm font-medium" title={job.url}>
                                    {job.url}
                                </p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {downloadPlatform(job.url)}
                                </p>
                                <p className="text-sm">
                                    {downloadStatus(job)}
                                    {progress !== null ? ` · ${progress}%` : ''}
                                    {vm.requestedIds.includes(job.id) && job.state === 'pending'
                                        ? ' · 실행 요청 대기'
                                        : ''}
                                    {job.cleanupRequired ? ' · 정리 필요' : ''}
                                    {job.options === null ? ' · 이전 옵션 확인 필요' : ''}
                                </p>
                                {progress !== null && (
                                    <progress
                                        aria-label="다운로드 진행률"
                                        value={progress}
                                        max={100}
                                        className="h-1.5 w-full accent-[var(--color-primary)]"
                                    />
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className={button}
                                        data-detail-trigger
                                        aria-expanded={selected}
                                        onClick={() =>
                                            selected ? vm.closeDetail() : void vm.openDetail(job.id)
                                        }
                                    >
                                        {selected ? '상세 닫기' : '상세보기'}
                                    </button>
                                    <DownloadJobActions job={job} />
                                </div>
                                {job.state === 'running' && job.phase === 'committing' && (
                                    <p className="text-xs text-[var(--text-muted)]">
                                        저장 중에는 취소할 수 없습니다.
                                    </p>
                                )}
                            </div>
                        </li>
                    )
                })}
            </ul>
            {(vm.queue.length > 0 || vm.offset > 0) && (
                <nav aria-label="다운로드 작업 페이지" className="flex items-center gap-3">
                    <button
                        type="button"
                        className={button}
                        disabled={vm.loading || vm.offset === 0}
                        onClick={() => void vm.refresh(Math.max(0, vm.offset - DOWNLOAD_PAGE_SIZE))}
                    >
                        이전
                    </button>
                    <span className="text-sm">
                        {Math.floor(vm.offset / DOWNLOAD_PAGE_SIZE) + 1} 페이지
                    </span>
                    <button
                        type="button"
                        className={button}
                        disabled={vm.loading || !vm.hasNextPage}
                        onClick={() => void vm.refresh(vm.offset + DOWNLOAD_PAGE_SIZE)}
                    >
                        다음
                    </button>
                </nav>
            )}
        </section>
    )
}
