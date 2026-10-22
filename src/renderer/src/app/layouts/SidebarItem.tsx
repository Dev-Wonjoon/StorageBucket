import React from 'react'

interface SidebarItemProps {
    icon: React.ReactNode | null
    label: string
    isActive?: boolean
    onClick: () => void
}

export const SidebarItem = ({
    icon,
    label,
    isActive,
    onClick
}: SidebarItemProps): React.JSX.Element => {
    return (
        <button
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 px-4 py-3 mb-1 rounded-xl transition-all duration-200
                text-sm font-medium
                ${
                    isActive
                        ? 'bg-[var(--color-primary)] text-[var(--text-main)] shadow-lg shadow-[var(--color-primary)]/30'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
                }
            `}
        >
            <div className="w-5 h-5">{icon}</div>
            <span>{label}</span>
        </button>
    )
}
