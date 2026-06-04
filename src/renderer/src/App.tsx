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
import { StatusMessage } from './components/ui/StatusMessage'

function App(): ReactElement {
    const [activeMenu, setActiveMenu] = useState('gallery')
    const [showSetup, setShowSetup] = useState(false)
    const [isBootstrapReady, setIsBootstrapReady] = useState(false);
    const [bootstrapError, setBootstrapError] = useState<string | null>(null);
    const { startDownload } = useDownloadViewModel()

    useEffect(() => {
        const removeReady = window.api.onBootstrapReady(() => {
            setIsBootstrapReady(true);
        });

        const removeError = window.api.onBootstrapError((error) => {
            setBootstrapError(error.message);
        });

        return () => {
            removeReady();
            removeError();
        }
    }, []);

    useEffect(() => {
        if(!isBootstrapReady) return;
        if (!window.api?.getEngineStatus) return;

        const timer = window.setTimeout(() => {
            window.api.getEngineStatus().then((status: Record<string, EngineStatus>) => {
                const hasMissing = Object.values(status).some((s) => !s.installed)
                if(hasMissing) setShowSetup(true);
            })
        }, 500);

        return () => window.clearTimeout(timer);
    }, [isBootstrapReady]);

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
        <div className="grid h-screen w-full grid-cols-[232px_minmax(0,1fr)] overflow-hidden bg-slate-50 font-sans text-slate-950 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100 max-[840px]:grid-cols-1">
            <Sidebar activeMenu={activeMenu} onMenuClick={setActiveMenu} />

            <div className="grid h-screen min-w-0 grid-rows-[auto_minmax(0,1fr)]">
                <div className="grid min-h-[68px] items-center border-b border-slate-200 bg-slate-50/95 px-5 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
                    <DownloadBar />
                </div>

                <main>
                    {bootstrapError ? (
                        <StatusMessage type="error" message={bootstrapError}/>
                    ) : !isBootstrapReady ? (
                        <StatusMessage type="loading" message="Preparing library..."/>
                    ) : (
                        renderContent()
                    )}

                </main>
            </div>

            {showSetup && <EngineSetupModal onComplete={() => setShowSetup(false)} />}
        </div>
    )
}

export default App
