import { ReactNode } from 'react'

interface SettingSectionProps {
    title: string
    description?: string
    children: ReactNode
}

export const SettingSection = ({
    title,
    description,
    children
}: SettingSectionProps): React.JSX.Element => {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-[var(--text-main)]">{title}</h2>
                {description && (
                    <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>
                )}
            </div>

            <div className="rounded-lg border border-[var(--border-line)] divide-y divide-[var(--border-line)]">
                {children}
            </div>
        </div>
    )
}
