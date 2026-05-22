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
    const tabButtonClass = (active: boolean): string =>
        [
            'flex h-10 w-full items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors',
            active
                ? 'border-slate-200 bg-slate-100 font-bold text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
        ].join(' ')

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
        <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] px-5 pb-5 pt-[18px]">
            <header>
                <h1 className="m-0 text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">
                    설정
                </h1>
                <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">
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
                            className={tabButtonClass(activeTab === id)}
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
