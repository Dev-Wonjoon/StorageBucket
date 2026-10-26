import { downloadFailure } from '../../../../../shared/download-api'
import { useDownloadViewModel } from '../useDownloadViewModel'
import { downloadPlatform, downloadStatus, visibleProgress } from '../downloadPresentation'
import { DownloadJobActions } from './DownloadJobActions'
import { DownloadThumbnail } from './DownloadThumbnail'

export function DownloadDetailPane(): React.JSX.Element | null {
    const vm = useDownloadViewModel()
    const { data: job, loading, error } = vm.detail
    if (loading) return <p role="status">작업 상세를 불러오는 중...</p>
    if (error)
        return (
            <div role="alert" className="space-y-3">
                <p>{error.message}</p>
                <button
                    type="button"
                    className="underline"
                    onClick={() => vm.detail.jobId && void vm.openDetail(vm.detail.jobId)}
                >
                    다시 불러오기
                </button>
            </div>
        )
    if (!job) return null
    const progress = visibleProgress(job)
    const failure = job.errorCode ? downloadFailure(job.errorCode) : null
    return (
        <section className="space-y-5" aria-label="선택한 다운로드 작업">
            <DownloadThumbnail />
            <div className="space-y-2">
                <h3 className="break-words text-lg font-semibold">
                    {job.title || '다운로드 작업'}
                </h3>
                <p className="text-sm text-[var(--text-muted)]">{downloadPlatform(job.url)}</p>
                <p className="select-text break-all text-sm">{job.url}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-line)] p-4 space-y-2">
                <p className="font-medium">
                    {downloadStatus(job)}
                    {progress !== null ? ` · ${progress}%` : ''}
                </p>
                {vm.requestedIds.includes(job.id) && job.state === 'pending' && (
                    <p className="text-sm">실행 요청 대기</p>
                )}
                {job.phase === 'committing' && job.state === 'running' && (
                    <p className="text-sm text-[var(--text-muted)]">
                        저장 중에는 취소할 수 없습니다.
                    </p>
                )}
                {job.cleanupRequired && (
                    <p className="text-sm">
                        임시 파일 정리가 필요해 다시 실행할 수 없습니다. 정리 실행 기능은 아직
                        제공되지 않습니다.
                    </p>
                )}
                {job.options === null && (
                    <p className="text-sm">
                        이전 다운로드 옵션을 확인해야 다시 실행할 수 있습니다.
                    </p>
                )}
                {failure && !failure.ok && (
                    <p role="alert" className="text-sm">
                        {failure.error.message}
                        <br />
                        <span className="text-[var(--text-muted)]">오류 코드: {job.errorCode}</span>
                    </p>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
                <DownloadJobActions job={job} />
            </div>
            {job.options && (
                <div className="space-y-3">
                    <h3 className="font-medium">다운로드 옵션</h3>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                        <dt className="text-[var(--text-muted)]">종류</dt>
                        <dd>
                            {job.options.type === 'audio' || job.options.quality === 'audio'
                                ? '오디오'
                                : '영상'}
                        </dd>
                        <dt className="text-[var(--text-muted)]">화질</dt>
                        <dd>{job.options.quality || '기본 화질'}</dd>
                        <dt className="text-[var(--text-muted)]">형식</dt>
                        <dd>{job.options.extension || '기본 형식'}</dd>
                        <dt className="text-[var(--text-muted)]">재생목록</dt>
                        <dd>{job.options.playlist ? '포함' : '단일 영상'}</dd>
                    </dl>
                </div>
            )}
            {vm.halted && (
                <p role="alert" className="text-sm">
                    {vm.halted}
                </p>
            )}
        </section>
    )
}
