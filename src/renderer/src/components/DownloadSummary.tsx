import { type ReactElement } from 'react'

interface DownloadSummaryProps {
    activeCount: number
    totalProgress: number
    onClick: () => void
}

export const DownloadSummary = ({
    activeCount,
    totalProgress,
    onClick
}: DownloadSummaryProps): ReactElement => {
    return (
        <div
            onClick={onClick}
            className="group relative cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        >
            <div
                className="absolute bottom-0 left-0 top-0 bg-indigo-500/5 transition-all duration-500 ease-out"
                style={{ width: `${totalProgress}` }}
            />
            <div className="relative flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <div
                        className={`rounded-full p-2 ${activeCount > 0 ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}
                    ></div>
                </div>
            </div>
        </div>
    )
}
