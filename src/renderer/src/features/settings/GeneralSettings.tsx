import { Button } from '@renderer/components/ui/Button'
import { useGeneralSettingsViewModel } from './useGeneralSettingsViewModel'
import { SettingSection } from '@renderer/components/ui/SettingSection'
import { SettingRow } from '@renderer/components/ui/SettingRow'

export const GeneralSettings = () => {
    const { downloadPath, changePath } = useGeneralSettingsViewModel()

    return (
        <SettingSection title="일반 설정" description="앱의 기본 동작을 설정합니다.">
            <SettingRow
                label="다운로드 경로"
                value={downloadPath || '설정되지 않음'}
                action={<Button onClick={changePath}>변경</Button>}
            />
        </SettingSection>
    )
}
