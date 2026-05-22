import { type ReactElement, type ReactNode } from 'react'

interface SidebarItemProps {
    icon: ReactNode | null
    label: string
    isActive?: boolean
    onClick: () => void
}

export const SidebarItem = ({ icon, label, isActive, onClick }: SidebarItemProps): ReactElement => {
    return (
        <button
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 px-4 py-3 mb-1 rounded-xl transition-all duration-200
                text-sm font-medium
                ${
                    isActive
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }
            `}
        >
            <div className="w-5 h-5">{icon}</div>
            <span>{label}</span>
        </button>
    )
}
