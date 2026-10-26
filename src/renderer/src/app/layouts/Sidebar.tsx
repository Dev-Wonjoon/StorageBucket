import type { AppMenu } from '../navigation'
import type { ReactNode } from 'react'
import { SidebarItem } from '@renderer/app/layouts/SidebarItem'
import { useTheme } from '@renderer/shared/hooks/useTheme'
import appIcon from '@renderer/assets/icon.ico?url'
import { Download, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun } from 'lucide-react'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'

const SIDEBAR_MENUS: Array<{ id: AppMenu; label: string; icon: ReactNode }> = [
    {
        id: 'gallery',
        label: '갤러리',
        icon: (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
                />
            </svg>
        )
    },
    {
        id: 'downloads',
        label: '다운로드',
        icon: <Download className="size-6" />
    },
    {
        id: 'search',
        label: '검색',
        icon: (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                />
            </svg>
        )
    },
    {
        id: 'favorites',
        label: '즐겨찾기',
        icon: (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-6"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
                />
            </svg>
        )
    }
]

interface SidebarProps {
    activeMenu: AppMenu
    onMenuClick: (id: AppMenu) => void
    collapsed: boolean
    onToggle: () => void
}

export const Sidebar = ({
    activeMenu,
    onMenuClick,
    collapsed,
    onToggle
}: SidebarProps): React.JSX.Element => {
    const { theme, toggleTheme } = useTheme()
    const { requestedIds } = useDownloadViewModel()
    const themeLabel = theme === 'dark' ? '라이트모드 전환' : '다크모드 전환'
    const toggleLabel = collapsed ? '사이드바 펼치기' : '사이드바 접기'

    return (
        <aside
            id="app-sidebar"
            className="w-full h-full flex flex-col shadow-2xl transition-colors duration-200 bg-[var(--bg-sidebar)] border-r border-[var(--border-line)]"
        >
            <div
                className={`h-20 shrink-0 flex items-center mb-2 border-b border-[var(--border-line)] ${
                    collapsed ? 'justify-center' : 'px-3 gap-2'
                }`}
            >
                {!collapsed && (
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                        <img
                            src={appIcon}
                            alt=""
                            width={28}
                            height={28}
                            className="size-7 shrink-0 object-contain"
                        />

                        <h1 className="text-base font-bold whitespace-nowrap text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">
                            Storage Bucket
                        </h1>
                    </div>
                )}

                <button
                    type="button"
                    onClick={onToggle}
                    aria-label={toggleLabel}
                    aria-expanded={!collapsed}
                    aria-controls="app-sidebar"
                    title={toggleLabel}
                    className="size-9 shrink-0 flex items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                >
                    {collapsed ? (
                        <PanelLeftOpen className="size-5" aria-hidden="true" />
                    ) : (
                        <PanelLeftClose className="size-5" aria-hidden="true" />
                    )}
                </button>
            </div>

            <nav
                aria-label="주 메뉴"
                className="flex-1 min-h-0 px-3 py-4 flex flex-col gap-1 overflow-y-auto"
            >
                {SIDEBAR_MENUS.map((menu) => (
                    <SidebarItem
                        key={menu.id}
                        label={
                            menu.id === 'downloads' && requestedIds.length > 0
                                ? `다운로드 · 요청 ${requestedIds.length}`
                                : menu.label
                        }
                        icon={menu.icon}
                        isActive={activeMenu === menu.id}
                        collapsed={collapsed}
                        onClick={() => onMenuClick(menu.id)}
                    />
                ))}
            </nav>

            <div
                className={`p-3 border-t border-[var(--border-line)] flex gap-2 ${
                    collapsed ? 'flex-col items-center' : 'items-center'
                }`}
            >
                <div className={collapsed ? 'w-full' : 'flex-1 min-w-0'}>
                    <SidebarItem
                        label="설정"
                        icon={<Settings className="size-6" />}
                        isActive={activeMenu === 'settings'}
                        collapsed={collapsed}
                        onClick={() => onMenuClick('settings')}
                    />
                </div>

                <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label={themeLabel}
                    title={themeLabel}
                    className="size-11 shrink-0 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                >
                    {theme === 'dark' ? (
                        <Sun className="size-5" aria-hidden="true" />
                    ) : (
                        <Moon className="size-5" aria-hidden="true" />
                    )}
                </button>
            </div>
        </aside>
    )
}
