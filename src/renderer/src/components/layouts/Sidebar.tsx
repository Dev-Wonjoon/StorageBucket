import { Grid3X3, Heart, Moon, Search, Settings, Sun } from 'lucide-react'
import { type ReactElement } from 'react'
import { useTheme } from '@renderer/hooks/useTheme'
import { IconButton } from '@renderer/components/ui/IconButton'

const SIDEBAR_MENUS = [
    { id: 'gallery', label: '갤러리', icon: Grid3X3 },
    { id: 'search', label: '검색', icon: Search },
    { id: 'favorites', label: '즐겨찾기', icon: Heart }
]

interface SidebarProps {
    activeMenu: string
    onMenuClick: (id: string) => void
}

export const Sidebar = ({ activeMenu, onMenuClick }: SidebarProps): ReactElement => {
    const { theme, toggleTheme } = useTheme()
    const ThemeIcon = theme === 'dark' ? Sun : Moon
    const navButtonClass = (active: boolean): string =>
        [
            'flex h-10 w-full items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors',
            active
                ? 'border-slate-200 bg-slate-100 font-bold text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
        ].join(' ')

    return (
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 max-[840px]:hidden">
            <div className="flex h-[68px] flex-none items-center gap-2.5 border-b border-slate-200 px-[18px] dark:border-slate-800">
                <div className="grid h-[34px] w-[34px] place-items-center rounded-lg bg-slate-950 text-[13px] font-extrabold text-white dark:bg-slate-100 dark:text-slate-950">
                    SB
                </div>
                <div className="min-w-0">
                    <h1 className="truncate text-[15px] font-extrabold leading-tight text-slate-950 dark:text-slate-100">
                        StorageBucket
                    </h1>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        Media Library
                    </p>
                </div>
            </div>

            <nav className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 py-3.5" aria-label="주 메뉴">
                {SIDEBAR_MENUS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onMenuClick(id)}
                        className={navButtonClass(activeMenu === id)}
                    >
                        <Icon size={18} strokeWidth={1.8} />
                        <span>{label}</span>
                    </button>
                ))}
            </nav>

            <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <strong className="text-slate-950 dark:text-slate-100">
                            다운로드 엔진
                        </strong>
                        <span className="text-slate-500 dark:text-slate-400">ready</span>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => onMenuClick('settings')}
                            className={`${navButtonClass(activeMenu === 'settings')} h-9 flex-1`}
                        >
                            <Settings size={17} strokeWidth={1.8} />
                            <span>설정</span>
                        </button>
                        <IconButton
                            onClick={toggleTheme}
                            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                            aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                        >
                            <ThemeIcon size={17} strokeWidth={1.8} />
                        </IconButton>
                    </div>
                </div>
            </div>
        </aside>
    )
}
