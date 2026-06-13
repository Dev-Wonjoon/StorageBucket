import { Copy, X } from 'lucide-react'
import { type ReactElement } from 'react'
import { BaseModal } from '@renderer/components/ui/BaseModal'
import { IconButton } from '@renderer/components/ui/IconButton'
import { type DownloadLog } from 'src/shared/types'

interface DownloadLogModalProps {
    log: DownloadLog
    onClose: () => void
}

const formatDateTime = (value?: string): string => {
    if (!value) return ''

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''

    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}

export const DownloadLogModal = ({ log, onClose }: DownloadLogModalProps): ReactElement => {
    const startedAt = formatDateTime(log.startedAt)
    const finishedAt = formatDateTime(log.finishedAt)

    return (
        <BaseModal onClose={onClose}>
            <div className="grid max-h-[80vh] w-[720px] max-w-[calc(100vw-32px)] grid-rows-[auto_minmax(0,1fr)]">
                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <h2 className="text-sm font-bold text-slate-950 dark:text-slate-100">
                        다운로드 로그
                    </h2>
                    <IconButton size="sm" onClick={onClose} title="닫기" aria-label="닫기">
                        <X size={16} />
                    </IconButton>
                </header>

                <div className="min-h-0 overflow-auto p-4 text-sm text-slate-700 dark:text-slate-200">
                    <section className="grid gap-1">
                        <p className="font-bold">{log.summary || '로그 요약이 없습니다.'}</p>
                        {log.engine && <p>엔진: {log.engine}</p>}
                        {startedAt && <p>시작: {startedAt}</p>}
                        {finishedAt && <p>종료: {finishedAt}</p>}
                        {log.outputPath && <p className="break-all">저장 위치: {log.outputPath}</p>}
                        {log.itemCount !== undefined && <p>등록된 미디어: {log.itemCount}개</p>}
                    </section>

                    <section className="mt-4">
                        <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                            진행 기록
                        </h3>
                        {(log.steps ?? []).length > 0 ? (
                            <ul className="grid gap-1">
                                {(log.steps ?? []).map((step, index) => (
                                    <li key={`${step}-${index}`}>{step}</li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-slate-500 dark:text-slate-400">
                                진행 기록이 없습니다.
                            </p>
                        )}
                    </section>

                    {log.raw && (
                        <section className="mt-4">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                    원본 로그
                                </h3>
                                <IconButton
                                    size="sm"
                                    onClick={() => navigator.clipboard.writeText(log.raw || '')}
                                    title="복사"
                                    aria-label="복사"
                                >
                                    <Copy size={16} />
                                </IconButton>
                            </div>
                            <pre className="max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                                {log.raw}
                            </pre>
                        </section>
                    )}
                </div>
            </div>
        </BaseModal>
    )
}
