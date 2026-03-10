import { SettingSection } from "@renderer/components/ui/SettingSection";
import { useLicenseSettingsViewModel } from "./useLicenseSettingsViewModel"


export const LicenseSettings = () => {
    const { licenses, expanded, toggle } = useLicenseSettingsViewModel();

    return (
         <SettingSection
            title="오픈소스 라이센스"
            description="이 애플리케이션은 다음 오픈소스 소프트웨어를 외부 도구로 사용합니다. 이 도구들은 앱에 포함되지 않으며, 사용자가 별도로 설치합니다."
        >
            {licenses.map((license) => (
                <div key={license.name}>
                    <button
                        onClick={() => toggle(license.name)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[--text-main] hover:bg-[--bg-hover] transition-colors"
                    >
                        <span>{license.name}</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                            strokeWidth="1.5" stroke="currentColor"
                            className={`size-4 text-[--text-muted] transition-transform ${expanded === license.name ? 'rotate-180' : ''}`}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                        </svg>
                    </button>

                    {expanded === license.name && (
                        <div className="px-4 pb-3 space-y-2">
                            <p className="text-xs text-[--text-muted] leading-relaxed">
                                {license.notice}
                            </p>
                            <a
                                href={license.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-xs text-[--color-primary] hover:underline"
                            >
                                라이센스 전문 보기
                            </a>
                        </div>
                    )}
                </div>
            ))}
        </SettingSection>
    )
}