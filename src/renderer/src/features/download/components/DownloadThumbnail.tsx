import { Download } from 'lucide-react'

export function DownloadThumbnail(): React.JSX.Element | null {
    return (
        <div
            role="img"
            aria-label="썸네일 없음"
            className="flex aspect-video w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-[var(--bg-hover)] text-[var(--text-muted)] sm:w-36"
        >
            <Download className="size-6" aria-hidden="true" />
            <span className="text-xs">썸네일 없음</span>
        </div>
    )
}
