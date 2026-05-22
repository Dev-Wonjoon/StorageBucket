import { type ReactElement, useState, useEffect } from 'react'
import { BaseModal } from './ui/BaseModal'

interface EngineStatus {
    installed: boolean
    version: string | null
}

interface EngineStatusProps {
    onComplete: () => void
}

export function EngineSetupModal({ onComplete }: EngineStatusProps): ReactElement | null {
    const [engines, setEngines] = useState<Record<string, EngineStatus>>({})
    const [installing, setInstalling] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        window.api.getEngineStatus().then((status) => {
            setEngines(status)
            setLoading(false)
        })
    }, [])

    const missingEngine = Object.entries(engines).filter(([, s]) => !s.installed)
    const allInstalled = !loading && missingEngine.length === 0

    const handleInstall = async (name: string): Promise<void> => {
        setInstalling(name)

        try {
            await window.api.installEngine(name)
            const status = await window.api.getEngineStatus()
            setEngines(status)
        } catch (error) {
            console.error(`Failed to install ${name}:`, error)
        } finally {
            setInstalling(null)
        }
    }

    const handleInstallAll = async (): Promise<void> => {
        for (const [name] of missingEngine) {
            await handleInstall(name)
        }
    }

    if (loading) return null

    return (
        <BaseModal onClose={onComplete}>
            <div className="min-w-[400px] border border-slate-200 p-6 dark:border-slate-700">
                <h2 className="mb-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
                    엔진 설정
                </h2>
                <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
                    다운로드에 필요한 엔진이 설치되어 있지 않습니다.
                </p>

                <div className="space-y-3 mb-5">
                    {Object.entries(engines).map(([name, status]) => (
                        <div
                            key={name}
                            className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800"
                        >
                            <div>
                                <span className="font-medium text-slate-950 dark:text-slate-100">
                                    {name}
                                </span>
                                {status.installed && (
                                    <span className="ml-2 text-xs text-green-500">
                                        {status.version || '설치됨'}
                                    </span>
                                )}
                            </div>
                            {status.installed ? (
                                <span className="text-xs text-green-500">✓</span>
                            ) : (
                                <button
                                    onClick={() => handleInstall(name)}
                                    disabled={installing !== null}
                                    className="rounded-lg bg-indigo-600 px-3 py-1 text-xs text-white disabled:opacity-50"
                                >
                                    {installing === name ? '설치 중...' : '설치'}
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                <div className="flex gap-2 justify-end">
                    {!allInstalled && (
                        <button
                            onClick={handleInstallAll}
                            disabled={installing !== null}
                            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                        >
                            {installing ? '설치 중...' : '모두 설치'}
                        </button>
                    )}
                    <button
                        onClick={onComplete}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-950 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        {allInstalled ? '시작하기' : '나중에'}
                    </button>
                </div>
            </div>
        </BaseModal>
    )
}
