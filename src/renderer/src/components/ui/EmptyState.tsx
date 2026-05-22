import { type ReactElement, type ReactNode } from 'react'

interface EmptyStateProps {
    icon?: ReactNode
    title: string
    description?: string
    className?: string
}

export const EmptyState = ({
    icon,
    title,
    description,
    className = ''
}: EmptyStateProps): ReactElement => {
    return (
        <div
            className={`flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400 ${className}`}
        >
            {icon}
            <p className="mt-3 text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</p>
            {description && <p className="mt-1 text-sm">{description}</p>}
        </div>
    )
}
