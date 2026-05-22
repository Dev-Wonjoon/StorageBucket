import { type ReactElement } from 'react'

interface StatusMessageProps {
    type?: 'loading' | 'error' | 'empty'
    message: string
}

export const StatusMessage = ({ type = 'loading', message }: StatusMessageProps): ReactElement => {
    const colors = {
        loading: 'text-slate-500 dark:text-slate-400',
        error: 'text-red-500 dark:text-red-400',
        empty: 'text-slate-500 dark:text-slate-400'
    }

    return (
        <div className={`flex items-center justify-center h-32 text-sm ${colors[type]}`}>
            {type === 'loading' && (
                <svg className="animate-spin size-4 mr-2" viewBox="0 0 24 24" fill="none">
                    <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                    />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                </svg>
            )}
            {message}
        </div>
    )
}
