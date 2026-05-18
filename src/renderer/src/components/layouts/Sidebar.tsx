import { Grid3X3, Heart, Moon, Search, Settings, Sun } from 'lucide-react'
import { type ReactElement } from 'react'
import { useTheme } from '@renderer/hooks/useTheme'

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

    return (
        <aside className="sb-sidebar">
            <div className="sb-brand">
                <div className="sb-brand-mark">SB</div>
                <div className="min-w-0">
                    <h1 className="truncate text-[15px] font-extrabold leading-tight text-[var(--text-main)]">
                        StorageBucket
                    </h1>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                        Media Library
                    </p>
                </div>
            </div>

            <nav className="sb-nav" aria-label="주 메뉴">
                {SIDEBAR_MENUS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onMenuClick(id)}
                        className={`sb-nav-button ${activeMenu === id ? 'is-active' : ''}`}
                    >
                        <Icon size={18} strokeWidth={1.8} />
                        <span>{label}</span>
                    </button>
                ))}
            </nav>

            <div className="border-t border-[var(--border-line)] p-3">
                <div className="grid gap-2 rounded-lg border border-[var(--border-line)] bg-[var(--bg-popup)] p-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <strong className="text-[var(--text-main)]">다운로드 엔진</strong>
                        <span className="text-[var(--text-muted)]">ready</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-active)]">
                        <div className="h-full w-2/3 rounded-full bg-[var(--color-green)]" />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => onMenuClick('settings')}
                            className={`sb-nav-button h-9 flex-1 ${activeMenu === 'settings' ? 'is-active' : ''}`}
                        >
                            <Settings size={17} strokeWidth={1.8} />
                            <span>설정</span>
                        </button>
                        <button
                            type="button"
                            onClick={toggleTheme}
                            className="sb-icon-button h-9 w-9"
                            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                            aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                        >
                            <ThemeIcon size={17} strokeWidth={1.8} />
                        </button>
                    </div>
                </div>
            </div>
        </aside>
    )
}
