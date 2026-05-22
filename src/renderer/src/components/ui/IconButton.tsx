import { type ButtonHTMLAttributes, type ReactElement } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    size?: 'sm' | 'md'
    active?: boolean
}

export const IconButton = ({
    size = 'md',
    active = false,
    className = '',
    children,
    ...props
}: IconButtonProps): ReactElement => {
    const sizes = {
        sm: 'h-8 w-8',
        md: 'h-9 w-9'
    }

    const state = active
        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100'

    return (
        <button
            type="button"
            className={`inline-grid place-items-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${state} ${className}`}
            {...props}
        >
            {children}
        </button>
    )
}
