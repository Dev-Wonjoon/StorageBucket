import { useState } from 'react'
import { toMediaUrl } from '@renderer/shared/utils/media'

export function MediaPreview({
    path,
    title,
    className = ''
}: {
    path: string | null
    title: string
    className?: string
}) {
    const url = toMediaUrl(path)

    const [failedUrl, setFailedUrl] = useState<string | null>(null)

    if (!url || url === failedUrl) {
        return (
            <div
                className={
                    className + ' flex items-center justify-center text-sm text-[var(--text-muted)]'
                }
            >
                미리보기 없음
            </div>
        )
    }

    return (
        <img
            src={url}
            alt={title}
            loading="lazy"
            className={className}
            onError={() => setFailedUrl(url)}
        />
    )
}
