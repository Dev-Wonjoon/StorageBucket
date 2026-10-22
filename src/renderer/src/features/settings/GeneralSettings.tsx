import { Button } from '@renderer/shared/components/ui/Button'
import { useGeneralSettingsViewModel } from '@renderer/features/settings/useGeneralSettingsViewModel'
import { SettingSection } from '@renderer/shared/components/ui/SettingSection'
import { SettingRow } from '@renderer/shared/components/ui/SettingRow'

export const GeneralSettings = (): React.JSX.Element => {
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
