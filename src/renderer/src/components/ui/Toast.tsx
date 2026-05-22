import {
    type ReactElement,
    type ReactNode,
    createContext,
    useCallback,
    useContext,
    useRef,
    useState
} from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
    id: string
    message: string
    type: ToastType
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = (): ToastContextType => {
    const context = useContext(ToastContext)
    if (!context) throw new Error('useToast must be used within ToastProvider')
    return context
}

export const ToastProvider = ({ children }: { children: ReactNode }): ReactElement => {
    const [toasts, setToasts] = useState<Toast[]>([])
    const counterRef = useRef(0)

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = String(++counterRef.current)
        setToasts((prev) => [...prev, { id, message, type }])

        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 3000)
    }, [])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`animate-slide-up rounded-lg px-4 py-3 text-sm font-medium shadow-lg
                            ${toast.type === 'success' ? 'bg-green-600 text-white' : ''}
                            ${toast.type === 'error' ? 'bg-red-600 text-white' : ''}
                            ${toast.type === 'info' ? 'border border-slate-200 bg-white text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100' : ''}
                        `}
                    >
                        {toast.message}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    )
}
