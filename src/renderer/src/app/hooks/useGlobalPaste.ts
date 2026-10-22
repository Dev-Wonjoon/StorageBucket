import { useEffect } from 'react'
import { isHttpUrl } from '@renderer/shared/utils/url'

export function useGlobalPaste(onUrl: (url: string) => Promise<boolean>): void {
    useEffect(() => {
        const handlePaste = (event: ClipboardEvent): void => {
            const target = event.target
            if (
                target instanceof Element &&
                target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
            )
                return
            const text = event.clipboardData?.getData('text')?.trim()
            if (text && isHttpUrl(text)) void onUrl(text)
        }
        window.addEventListener('paste', handlePaste)
        return () => window.removeEventListener('paste', handlePaste)
    }, [onUrl])
}
