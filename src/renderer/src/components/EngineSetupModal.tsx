import { useState, useEffect } from "react";

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[--bg-sidebar] border border-[--border-line] rounded-2xl p-6 shadow-2xl">
                <h2 className="text-lg font-semibold text-[--text-main] mb-1">엔진 설정</h2>
                <p className="text-sm text-[--text-muted] mb-5">
                    다운로드에 필요한 엔진이 설치되어 있지 않습니다.
                </p>

                <div className="space-y-3 mb-5">
                    {Object.entries(engines).map(([name, status]) => (
                        <div key={name} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[--bg-app]">
                            <div>
                                <span className="font-medium text-[--text-main]">{name}</span>
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
                                    className="text-xs px-3 py-1 rounded-lg bg-[--color-primary] text-white disabled:opacity-50"
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
                            className="px-4 py-2 rounded-xl bg-[--color-primary] text-white text-sm disabled:opacity-50"
                        >
                            {installing ? '설치 중...' : '모두 설치'}
                        </button>
                    )}
                    <button
                        onClick={onComplete}
                        className="px-4 py-2 rounded-xl border border-[--border-line] text-[--text-main] text-sm hover:bg-[--bg-hover]"
                    >
                        {allInstalled ? '시작하기' : '나중에'}
                    </button>
                </div>
            </div>
        </div>
    )
    
}