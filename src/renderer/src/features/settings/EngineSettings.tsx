import { useEngineSettingsViewModel } from "./useEngineSettingsViewModel";

const ENGINE_LABELS: Record<string, string> = {
    'yt-dlp': 'yt-dlp',
    'gallery-dl': 'gallery-dl',
    'ffmpeg': 'FFmpeg',
};

export const EngineSettings = () => {
    const { engines, installing, loading, install } = useEngineSettingsViewModel();

    if(loading) {
        return (
            <div className="flex items-center justify-center h-32 text-[--text-muted] text-sm">
                엔진 상태 확인 중...
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold">엔진 관리</h2>
            <p className="text-sm text-[--text-muted]">
                다운로드에 사용되는 외부 도구를 관리합니다.
            </p>

            <div className="space-y-3">
                {Object.entries(engines).map(([name, status]) => (
                    <div
                        key={name}
                        className="flex items-center justify-between px-4 py-3 rounded-lg bg-[--bg-active]"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-2 h-2 rounded-full flex-none ${
                                status.installed ? 'bg-emerald-400' : 'bg-red-400'
                            }`} />
                            <div className="min-w-0">
                                <span className="text-sm font-medium">
                                    {ENGINE_LABELS[name] || name}
                                </span>
                                <p className="text-xs text-[--text-muted] truncate">
                                    {status.installed
                                        ? status.version || '버전 확인 불가'
                                        : '미설치'
                                    }
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => install(name)}
                            disabled={installing !== null}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                                ${installing === name
                                    ? 'bg-[--bg-hover] text-[--text-muted] cursor-wait'
                                    : 'bg-[--color-primary] text-white hover:opacity-90'
                                }
                                disabled:opacity-50 disabled:cursor-not-allowed
                            `}
                        >
                            {installing === name
                                ? '설치 중...'
                                : status.installed ? '업데이트' : '설치'
                            }
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}