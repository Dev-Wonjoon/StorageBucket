import type { ReactNode } from 'react'

interface SidebarItemProps {
    icon: ReactNode
    label: string
    isActive?: boolean
    collapsed?: boolean
    onClick: () => void
}

export const SidebarItem = ({
    icon,
    label,
    isActive,
    collapsed = false,
    onClick
}: SidebarItemProps): React.JSX.Element => {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            title={collapsed ? label : undefined}
            className={`
                w-full flex items-center py-3 rounded-xl
                transition-colors duration-200 text-sm font-medium
                ${collapsed ? 'justify-center px-0' : 'gap-3 px-4'}
                ${
                    isActive
                        ? 'bg-[var(--color-primary)] text-[var(--text-main)] shadow-lg shadow-[var(--color-primary)]/30'
                        : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
                }
            `}
        >
            <span
                className="size-6 shrink-0 flex items-center justify-center"
                aria-hidden="true"
            >
                {icon}
            </span>

            {!collapsed && <span className="whitespace-nowrap">{label}</span>}
        </button>
    )
}