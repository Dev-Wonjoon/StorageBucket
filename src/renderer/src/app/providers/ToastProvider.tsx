import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastType } from '@renderer/shared/context/toastContext'

interface Toast {
    id: number
    message: string
    type: ToastType
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
    const [toasts, setToasts] = useState<Toast[]>([])
    const counter = useRef(0)
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
    useEffect(() => {
        const activeTimers = timers.current
        return () => {
            activeTimers.forEach(clearTimeout)
            activeTimers.clear()
        }
    }, [])
    const showToast = useCallback((message: string, type: ToastType = 'info'): void => {
        const id = ++counter.current
        setToasts((previous) => [...previous, { id, message, type }])
        const timer = setTimeout(() => {
            timers.current.delete(timer)
            setToasts((previous) => previous.filter((toast) => toast.id !== id))
        }, 3000)
        timers.current.add(timer)
    }, [])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div aria-live="polite" className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up
            ${toast.type === 'success' ? 'bg-green-600 text-white' : ''}
            ${toast.type === 'error' ? 'bg-red-600 text-white' : ''}
            ${toast.type === 'info' ? 'bg-[var(--bg-sidebar)] text-[var(--text-main)] border border-[var(--border-line)]' : ''}`}
                    >
                        {toast.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    )
}
