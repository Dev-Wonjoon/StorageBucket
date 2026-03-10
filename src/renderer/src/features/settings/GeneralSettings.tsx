import { useGeneralSettingsViewModel } from "./useGeneralSettingsViewModel";

export const GeneralSettings = () => {
    const { downloadPath, changePath } = useGeneralSettingsViewModel();

    return (
        <div className="space-y-6">
            <h2 className="text-lg font-semibold">일반 설정</h2>
            <div className="space-y-2">
                <label className="text-sm font-medium text-[--text-muted]">다운로드 경로</label>
                <div className="flex items-center gap-3">
                    <span className="flex-1 px-3 py-2 rounded-lg bg-[--bg-active] text-sm truncate">
                        {downloadPath || '설정되지 않음'}
                    </span>
                    <button
                        onClick={changePath}
                        className="px-4 py-2 rounded-lg bg-[--color-primary] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        변경
                    </button>
                </div>
            </div>
        </div>
    )
}