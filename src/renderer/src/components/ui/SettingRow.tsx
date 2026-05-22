import { type ReactElement, type ReactNode } from 'react'

interface SettingRowProps {
    label: string
    value?: string
    description?: string
    action?: ReactNode
    status?: 'success' | 'error'
}

export const SettingRow = ({
    label,
    value,
    description,
    action,
    status
}: SettingRowProps): ReactElement => {
    return (
        <div className="flex items-center justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
                {status && (
                    <div
                        className={`w-2 h-2 rounded-full flex-none ${
                            status === 'success' ? 'bg-emerald-400' : 'bg-red-400'
                        }`}
                    />
                )}
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-950 dark:text-slate-100">
                        {label}
                    </p>
                    {(value || description) && (
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            {value || description}
                        </p>
                    )}
                </div>
            </div>

            {action && <div className="flex-none">{action}</div>}
        </div>
    )
}
