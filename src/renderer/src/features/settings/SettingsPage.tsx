import { type ReactElement, useState } from 'react'
import { FileText, KeyRound, Settings, Wrench } from 'lucide-react'
import { GeneralSettings } from './GeneralSettings'
import { EngineSettings } from './EngineSettings'
import { LicenseSettings } from './LicenseSettings'
import { NetworkSettings } from './NetworkSettings'

const SETTINGS_TABS = [
    { id: 'general', label: '일반', icon: Settings },
    { id: 'engine', label: '엔진', icon: Wrench },
    { id: 'license', label: '라이선스', icon: FileText },
    { id: 'network', label: '네트워크', icon: KeyRound }
]

export const SettingsPage = (): ReactElement => {
    const [activeTab, setActiveTab] = useState('general')

    const renderContent = (): ReactElement => {
        switch (activeTab) {
            case 'general':
                return <GeneralSettings />
            case 'engine':
                return <EngineSettings />
            case 'license':
                return <LicenseSettings />
            case 'network':
                return <NetworkSettings />
            default:
                return <GeneralSettings />
        }
    }

    return (
        <section className="sb-library">
            <header>
                <h1 className="sb-page-title">설정</h1>
                <p className="sb-page-subtitle">
                    앱 동작, 다운로드 엔진, 라이선스 정보를 관리합니다.
                </p>
            </header>

            <div className="mt-5 flex min-h-0 flex-1 gap-6">
                <nav className="flex w-48 flex-none flex-col gap-1" aria-label="설정 메뉴">
                    {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setActiveTab(id)}
                            className={`sb-nav-button ${activeTab === id ? 'is-active' : ''}`}
                        >
                            <Icon size={17} strokeWidth={1.8} />
                            <span>{label}</span>
                        </button>
                    ))}
                </nav>

                <div className="min-w-0 flex-1 overflow-auto">{renderContent()}</div>
            </div>
        </section>
    )
}
