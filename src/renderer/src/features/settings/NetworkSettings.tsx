import { getApi } from '@renderer/shared/api'
import { useState, useEffect } from 'react'
import { SettingSection } from '@renderer/shared/components/ui/SettingSection'
import { SettingRow } from '@renderer/shared/components/ui/SettingRow'
import { Button } from '@renderer/shared/components/ui/Button'

const BROWSER_OPTIONS = [
    { value: '', label: '사용 안 함' },
    { value: 'chrome', label: 'Chrome' },
    { value: 'firefox', label: 'Firefox' },
    { value: 'Edge', label: 'Edge' }
]

export const NetworkSettings = (): React.JSX.Element => {
    const [browser, setBrowser] = useState('')
    const [cookieFile, setCookieFile] = useState('')

    useEffect(() => {
        getApi().getCookieBrowser().then(setBrowser)
        getApi().getCookieFilePath().then(setCookieFile)
    }, [])

    const handleBrowserChange = (value: string): void => {
        setBrowser(value)
        getApi().setCookieBrowser(value)
    }

    const handleSelectCookieFile = async (): Promise<void> => {
        const path = await getApi().setCookieFilePath()
        if (path) setCookieFile(path)
    }

    const handleClearCookieFile = (): void => {
        setCookieFile('')
        getApi().clearCookieFilePath()
    }

    return (
        <SettingSection
            title="네트워크 설정"
            description="다운로드 시 사용되는 네트워크 관련 설정입니다."
        >
            <SettingRow
                label="쿠키 브라우저"
                description="브라우저에서 쿠키를 자동으로 가져옵니다."
                value={BROWSER_OPTIONS.find((o) => o.value === browser)?.label || '사용 안 함'}
                action={
                    <select
                        value={browser}
                        onChange={(e) => handleBrowserChange(e.target.value)}
                        className="bg-[var(--bg-active)] text-[var(--text-main)] text-xs rounded-lg px-3 py-1.5 border border-[var(--border-line)] outline-none"
                    >
                        {BROWSER_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                }
            />
            <SettingRow
                label="쿠키 파일"
                description="Netscape 형식의 cookies.txt 파일을 직접 지정합니다."
                value={cookieFile || '설정되지 않음'}
                action={
                    <div className="flex gap-2">
                        <Button onClick={handleSelectCookieFile}>선택</Button>
                        {cookieFile && (
                            <Button variant="ghost" onClick={handleClearCookieFile}>
                                초기화
                            </Button>
                        )}
                    </div>
                }
            />
        </SettingSection>
    )
}
