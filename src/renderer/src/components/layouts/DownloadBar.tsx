import { type ClipboardEvent, type FormEvent, type ReactElement, useState } from 'react'
import { Download, Link2, Loader2, RefreshCw } from 'lucide-react'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'

export function DownloadBar(): ReactElement {
    const [url, setUrl] = useState('')
    const [isChecking, setIsChecking] = useState(false)
    const { activeCount, startDownload } = useDownloadViewModel()

    const submitUrl = (value: string): void => {
        const nextUrl = value.trim()
        if (!nextUrl) return

        setIsChecking(true)
        startDownload(nextUrl)

        window.setTimeout(() => {
            setIsChecking(false)
            setUrl('')
        }, 800)
    }

    const handleSubmit = (e: FormEvent): void => {
        e.preventDefault()
        submitUrl(url)
    }

    const handlePaste = (e: ClipboardEvent<HTMLInputElement>): void => {
        const pastedText = e.clipboardData.getData('text').trim()
        if (!pastedText) return

        try {
            new URL(pastedText)
        } catch {
            return
        }

        e.preventDefault()
        setUrl(pastedText)
        submitUrl(pastedText)
    }

    return (
        <form onSubmit={handleSubmit} className="sb-url-form">
            <div className="sb-input-shell">
                <Link2 size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onPaste={handlePaste}
                    placeholder="URL 붙여넣기"
                    aria-label="다운로드 URL"
                />
            </div>

            <div className="flex items-center gap-2">
                <button
                    type="submit"
                    disabled={isChecking || !url.trim()}
                    className="sb-primary-button"
                >
                    {isChecking ? (
                        <Loader2 size={18} strokeWidth={2} className="animate-spin" />
                    ) : (
                        <Download size={18} strokeWidth={2} />
                    )}
                    <span>다운로드</span>
                </button>
                <button
                    type="button"
                    className="sb-icon-button"
                    title="갤러리 새로고침"
                    aria-label="갤러리 새로고침"
                    onClick={() => window.dispatchEvent(new CustomEvent('gallery-refresh'))}
                >
                    <RefreshCw size={18} strokeWidth={1.8} />
                </button>
                {activeCount > 0 && (
                    <span className="rounded-md bg-[var(--color-coral-soft)] px-2 py-1 text-xs font-bold text-[var(--color-coral)]">
                        {activeCount}개 진행 중
                    </span>
                )}
            </div>
        </form>
    )
}
