import { useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Download, Link, LoaderCircle } from 'lucide-react'
import { useDownloadViewModel } from '../useDownloadViewModel'
import { Button } from '@renderer/shared/components/ui/Button'
import { isHttpUrl } from '@renderer/shared/utils/url'

export function DownloadBar(): React.JSX.Element {
    const [url, setUrl] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const pending = useRef(false)
    const { startDownload, ready, halted } = useDownloadViewModel()

    const submit = async (value: string): Promise<void> => {
        const trimmed = value.trim()
        if (!trimmed || pending.current) return
        pending.current = true
        setIsSubmitting(true)
        try {
            if (await startDownload(trimmed)) setUrl('')
        } finally {
            pending.current = false
            setIsSubmitting(false)
        }
    }

    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        void submit(url)
    }
    const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
        const text = event.clipboardData.getData('text').trim()
        if (!isHttpUrl(text)) return
        event.preventDefault()
        setUrl(text)
        void submit(text)
    }

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-4xl mx-auto flex gap-3">
            <div className="relative min-w-0 flex-1 group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Link className="size-5 text-[var(--text-muted)] group-focus-within:text-[var(--color-primary)]" />
                </div>
                <input
                    type="text"
                    aria-label="다운로드할 URL"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    onPaste={handlePaste}
                    disabled={isSubmitting || !ready || Boolean(halted)}
                    placeholder="다운로드할 링크를 붙여넣으세요..."
                    className="w-full min-w-0 pl-10 pr-4 py-2.5 rounded-xl border transition-all shadow-sm outline-none
            bg-[var(--bg-sidebar)] border-[var(--border-line)] text-[var(--text-main)]
            placeholder:text-[var(--text-placeholder)] focus:border-[var(--color-primary)]
            focus:ring-2 focus:ring-[var(--color-primary)]/20"
                />
            </div>
            <Button
                type="submit"
                size="md"
                disabled={isSubmitting || !url.trim() || !ready || Boolean(halted)}
                className="rounded-xl flex items-center gap-2 shadow-lg active:scale-95"
            >
                {isSubmitting ? (
                    <LoaderCircle className="size-4 animate-spin" />
                ) : (
                    <Download className="size-4" />
                )}
                <span>{isSubmitting ? '처리 중' : '다운로드'}</span>
            </Button>
        </form>
    )
}
