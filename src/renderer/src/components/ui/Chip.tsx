import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement } from 'react'

const chipClasses = {
    neutral:
        'border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
}

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
    active?: boolean
}

interface ChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean
}

export const Chip = ({
    active = false,
    className = '',
    children,
    ...props
}: ChipProps): ReactElement => (
    <span
        className={`inline-flex h-8 items-center rounded-lg border px-3 text-sm ${active ? chipClasses.active : chipClasses.neutral} ${className}`}
        {...props}
    >
        {children}
    </span>
)

export const ChipButton = ({
    active = false,
    className = '',
    children,
    ...props
}: ChipButtonProps): ReactElement => (
    <button
        type="button"
        className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-sm transition-colors ${active ? chipClasses.active : chipClasses.neutral} ${className}`}
        {...props}
    >
        {children}
    </button>
)
