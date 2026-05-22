import { type ClipboardEvent, type FormEvent, type ReactElement, useState } from 'react'
import { Download, Link2, Loader2, RefreshCw } from 'lucide-react'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'
import { Button } from '@renderer/components/ui/Button'
import { IconButton } from '@renderer/components/ui/IconButton'

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
        <form
            onSubmit={handleSubmit}
            className="grid grid-cols-[minmax(240px,1fr)_auto] gap-2.5 max-[840px]:grid-cols-1"
        >
            <div className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 focus-within:border-slate-300 focus-within:ring-4 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:focus-within:border-slate-600 dark:focus-within:ring-indigo-950">
                <Link2 size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onPaste={handlePaste}
                    placeholder="URL 붙여넣기"
                    aria-label="다운로드 URL"
                    className="min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
            </div>

            <div className="flex items-center gap-2">
                <Button
                    type="submit"
                    disabled={isChecking || !url.trim()}
                    size="lg"
                    className="min-w-[116px]"
                >
                    {isChecking ? (
                        <Loader2 size={18} strokeWidth={2} className="animate-spin" />
                    ) : (
                        <Download size={18} strokeWidth={2} />
                    )}
                    <span>다운로드</span>
                </Button>
                <IconButton
                    title="갤러리 새로고침"
                    aria-label="갤러리 새로고침"
                    onClick={() => window.dispatchEvent(new CustomEvent('gallery-refresh'))}
                >
                    <RefreshCw size={18} strokeWidth={1.8} />
                </IconButton>
                {activeCount > 0 && (
                    <span className="rounded-md bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-300">
                        {activeCount}개 진행 중
                    </span>
                )}
            </div>
        </form>
    )
}
