import { type ReactElement } from 'react'
import { SettingSection } from '@renderer/components/ui/SettingSection'
import { useEngineSettingsViewModel } from './useEngineSettingsViewModel'
import { SettingRow } from '@renderer/components/ui/SettingRow'
import { Button } from '@renderer/components/ui/Button'

const ENGINE_LABELS: Record<string, string> = {
    'yt-dlp': 'yt-dlp',
    'gallery-dl': 'gallery-dl',
    ffmpeg: 'FFmpeg'
}

export const EngineSettings = (): ReactElement => {
    const { engines, installing, loading, install } = useEngineSettingsViewModel()

    if (loading) {
        return (
            <div className="flex h-32 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                엔진 상태 확인 중...
            </div>
        )
    }

    return (
        <SettingSection title="엔진 관리" description="다운로드에 사용되는 외부 도구를 관리합니다.">
            {Object.entries(engines).map(([name, status]) => (
                <SettingRow
                    key={name}
                    label={ENGINE_LABELS[name] || name}
                    value={status.installed ? status.version || '버전 확인 불가' : '미설치'}
                    status={status.installed ? 'success' : 'error'}
                    action={
                        <Button
                            onClick={() => install(name)}
                            disabled={installing !== null}
                            className={installing === name ? 'cursor-wait' : ''}
                        >
                            {installing === name
                                ? '설치 중...'
                                : status.installed
                                  ? '업데이트'
                                  : '설치'}
                        </Button>
                    }
                />
            ))}
        </SettingSection>
    )
}
