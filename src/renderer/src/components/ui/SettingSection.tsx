import { type ReactElement, type ReactNode } from 'react'

interface SettingSectionProps {
    title: string
    description?: string
    children: ReactNode
}

export const SettingSection = ({
    title,
    description,
    children
}: SettingSectionProps): ReactElement => {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
                    {title}
                </h2>
                {description && (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
                )}
            </div>

            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {children}
            </div>
        </div>
    )
}
