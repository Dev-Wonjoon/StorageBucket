import { type ReactElement, useEffect, useState } from 'react'
import { Sidebar } from './components/layouts/Sidebar'
import { DownloadBar } from './components/layouts/DownloadBar'
import { GalleryPage } from './features/gallery/GalleryPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { useDownloadViewModel } from './features/download/useDownloadViewModel'
import { EngineSetupModal } from './components/EngineSetupModal'
import { FavoritesPage } from './features/favorites/FavoritesPage'
import { SearchPage } from './features/search/SearchPage'
import { type EngineStatus } from 'src/shared/types'

function App(): ReactElement {
    const [activeMenu, setActiveMenu] = useState('gallery')
    const [showSetup, setShowSetup] = useState(false)
    const { startDownload } = useDownloadViewModel()

    useEffect(() => {
        if (!window.api?.getEngineStatus) return

        window.api.getEngineStatus().then((status: Record<string, EngineStatus>) => {
            const hasMissing = Object.values(status).some((s) => !s.installed)
            if (hasMissing) setShowSetup(true)
        })
    }, [])

    useEffect(() => {
        const handleGlobalPaste = (e: ClipboardEvent): void => {
            const tag = (e.target as HTMLElement)?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA') return

            const text = e.clipboardData?.getData('text')?.trim()
            if (!text) return

            try {
                new URL(text)
            } catch {
                return
            }

            startDownload(text)
        }

        window.addEventListener('paste', handleGlobalPaste)
        return () => window.removeEventListener('paste', handleGlobalPaste)
    }, [startDownload])

    const renderContent = (): ReactElement => {
        switch (activeMenu) {
            case 'gallery':
                return <GalleryPage />
            case 'search':
                return <SearchPage />
            case 'favorites':
                return <FavoritesPage />
            case 'settings':
                return <SettingsPage />
            default:
                return <GalleryPage />
        }
    }

    return (
        <div className="sb-app font-sans transition-colors duration-200">
            <Sidebar activeMenu={activeMenu} onMenuClick={setActiveMenu} />

            <div className="sb-main">
                <div className="sb-topbar">
                    <DownloadBar />
                </div>

                <main className="sb-content">{renderContent()}</main>
            </div>

            {showSetup && <EngineSetupModal onComplete={() => setShowSetup(false)} />}
        </div>
    )
}

export default App
