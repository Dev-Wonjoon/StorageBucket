import { useState } from 'react'
import { Sidebar } from './layouts/Sidebar'
import { DownloadBar } from '@renderer/features/download/components/DownloadBar'
import { GalleryPage } from '@renderer/features/gallery/GalleryPage'
import { FavoritesPage } from '@renderer/features/favorites/FavoritesPage'
import { SearchPage } from '@renderer/features/search/SearchPage'
import { SettingsPage } from '@renderer/features/settings/SettingsPage'
import { EngineSetupModal } from '@renderer/features/settings/components/EngineSetupModal'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'
import { useEngineSetup } from './hooks/useEngineSetup'
import { useGlobalPaste } from './hooks/useGlobalPaste'
import type { AppMenu } from './navigation'
import { DownloadQueue } from '@renderer/features/download/components/DownloadQueue'

export default function App(): React.JSX.Element {
    const [activeMenu, setActiveMenu] = useState<AppMenu>('gallery')
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const { startDownload } = useDownloadViewModel()
    const { showSetup, closeSetup } = useEngineSetup()
    useGlobalPaste(startDownload)

    const pages: Record<AppMenu, React.JSX.Element> = {
        gallery: <GalleryPage />,
        search: <SearchPage />,
        favorites: <FavoritesPage />,
        settings: <SettingsPage />
    }

    return (
        <div className="flex h-screen w-full bg-[var(--bg-app)] text-[var(--text-main)] overflow-hidden font-sans transition-colors duration-200">
            <div
                className={`h-full shrink-0 transition-[width] duration-200 motion-reduce:transition-none ${
                    sidebarCollapsed ? 'w-20' : 'w-64'
                }`}
            >
                <Sidebar
                    activeMenu={activeMenu}
                    onMenuClick={setActiveMenu}
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed((previous) => !previous)}
                />
            </div>
            <div className="flex-1 flex flex-col h-full min-w-0 relative">
                <div className="flex-none p-4 h-20 border-b border-[var(--border-line)] bg-[var(--bg-app)]/95 backdrop-blur-sm z-10">
                    <DownloadBar />
                </div>
                <main className="flex-1 overflow-y-auto p-6">
                    <DownloadQueue />
                    {pages[activeMenu]}
                </main>
            </div>
            {showSetup && <EngineSetupModal onComplete={closeSetup} />}
        </div>
    )
}
