import { useState, useEffect } from "react";
import { BaseModal } from "./ui/BaseModal";

interface EngineStatus {
    installed: boolean;
    version: string | null;
}

interface EngineStatusProps {
    onComplete: () => void;
}

export function EngineSetupModal({ onComplete }: EngineStatusProps) {
    const [engines, setEngines] = useState<Record<string, EngineStatus>>({});
    const [installing, setInstalling] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        window.api.getEngineStatus().then((status) => {
            setEngines(status);
            setLoading(false);
        });
    }, []);

    const missingEngine = Object.entries(engines).filter(([, s]) => !s.installed);
    const allInstalled = !loading && missingEngine.length === 0;

    const handleInstall = async (name: string) => {
        setInstalling(name);

        try {
            await window.api.installEngine(name);
            const status = await window.api.getEngineStatus();
            setEngines(status);
        } catch(error) {
            console.error(`Failed to install ${name}:`, error);
        } finally {
            setInstalling(null);
        }
    };

    const handleInstallAll = async () => {
        for(const [name] of missingEngine) {
            await handleInstall(name);
        }
    };

    if(loading) return null;

    return (
        <BaseModal onClose={onComplete}>
            <div className="border border-[var(--border-line)] p-6 min-w-[400px]">
                <h2 className="text-lg font-semibold mb-1 text-[var(--text-main)]">엔진 설정</h2>
                <p className="text-sm mb-5 text-[var(--text-muted)]">
                    다운로드에 필요한 엔진이 설치되어 있지 않습니다.
                </p>

                <div className="space-y-3 mb-5">
                    {Object.entries(engines).map(([name, status]) => (
                        <div key={name} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--bg-app)]">
                            <div>
                                <span className="font-medium text-[var(--text-main)]">{name}</span>
                                {status.installed && (
                                    <span className="ml-2 text-xs text-green-500">{status.version || '설치됨'}</span>
                                )}
                            </div>
                            {status.installed ? (
                                <span className="text-xs text-green-500">✓</span>
                            ) : (
                                <button
                                    onClick={() => handleInstall(name)}
                                    disabled={installing !== null}
                                    className="text-xs px-3 py-1 rounded-lg disabled:opacity-50 bg-[var(--color-primary)] text-white"
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
                            className="px-4 py-2 rounded-xl text-sm disabled:opacity-50 bg-[var(--color-primary)] text-white"
                        >
                            {installing ? '설치 중...' : '모두 설치'}
                        </button>
                    )}
                    <button
                        onClick={onComplete}
                        className="px-4 py-2 rounded-xl text-sm border border-[var(--border-line)] text-[var(--text-main)]"
                    >
                        {allInstalled ? '시작하기' : '나중에'}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
}
