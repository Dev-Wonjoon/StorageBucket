import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getApi } from '@renderer/shared/api'
import { toMediaUrl } from '@renderer/shared/utils/media'

export function DownloadThumbnail({
    url,
    title = '다운로드 썸네일'
}: {
    url: string
    title?: string
}): React.JSX.Element {
    const [result, setResult] = useState<{
        url: string
        path: string | null
        loading: boolean
    }>({
        url,
        path: null,
        loading: true
    })

    const [failedSrc, setFailedSrc] = useState<string | null>(null)
    const [reload, setReload] = useState(0)

    useEffect(() => {
        let disposed = false

        setResult({ url, path: null, loading: true })
        setFailedSrc(null)

        void (async () => {
            try {
                const path = await getApi().getDownloadPreview(url)

                if (!disposed) {
                    setResult({ url, path, loading: false })
                }
            } catch {
                if (!disposed) {
                    setResult({ url, path: null, loading: false })
                }
            }
        })()

        return () => {
            disposed = true
        }
    }, [url, reload])

    const current = result.url === url ? result : null
    const src = toMediaUrl(current?.path)
    const loading = current === null || current.loading

    return (
        <div className="flex aspect-video w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-hover)] text-[var(--text-muted)] sm:w-36">
            {src && src !== failedSrc ? (
                <img
                    key={src}
                    src={src}
                    alt={title}
                    loading="lazy"
                    className="h-full w-full object-contain"
                    onError={() => setFailedSrc(src)}
                />
            ) : (
                <div className="flex flex-col items-center gap-0.5">
                    <Download className="size-6" aria-hidden="true" />

                    <span className="text-xs">{loading ? '미리보기 준비 중' : '썸네일 없음'}</span>

                    {!loading && (
                        <button
                            type="button"
                            data-detail-trigger
                            aria-label="썸네일 다시 불러오기"
                            className="text-[11px] leading-4 underline"
                            onClick={(event) => {
                                event.stopPropagation()
                                setReload((value) => value + 1)
                            }}
                        >
                            다시 시도
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
