import { type ReactElement } from 'react'
import { SettingSection } from '@renderer/components/ui/SettingSection'
import { useLicenseSettingsViewModel } from './useLicenseSettingsViewModel'

export const LicenseSettings = (): ReactElement => {
    const { licenses, expanded, toggle } = useLicenseSettingsViewModel()

    return (
        <SettingSection
            title="오픈소스 라이센스"
            description="이 애플리케이션은 다음 오픈소스 소프트웨어를 외부 도구로 사용합니다. 이 도구들은 앱에 포함되지 않으며, 사용자가 별도로 설치합니다."
        >
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                    Responsible use
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Use external download engines only for media you own, are authorized to download, or that is licensed for download. You are responsible for complying with copyright law, platform terms, and content licenses.
                </p>
            </div>
            {licenses.map((license) => (
                <div key={license.name}>
                    <button
                        onClick={() => toggle(license.name)}
                        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-950 transition-colors hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        <span>{license.name}</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="1.5"
                            stroke="currentColor"
                            className={`size-4 text-slate-500 transition-transform dark:text-slate-400 ${expanded === license.name ? 'rotate-180' : ''}`}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m19.5 8.25-7.5 7.5-7.5-7.5"
                            />
                        </svg>
                    </button>

                    {expanded === license.name && (
                        <div className="px-4 pb-3 space-y-2">
                            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                {license.notice}
                            </p>
                            <a
                                href={license.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400"
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
