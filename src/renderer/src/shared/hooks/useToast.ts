import { useContext } from 'react'
import { ToastContext } from '../context/toastContext'
import type { ToastContextValue } from '../context/toastContext'

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext)
    if (!context) throw new Error('useToast must be used within ToastProvider')
    return context
}
