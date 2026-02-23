import { useDownloadViewModel } from "@renderer/features/download/useDownloadViewModel";

export function DownloadStatusPanel() {
    const { queue, activeCount, isPanelOpen, togglePanel } = useDownloadViewModel();

    if(queue.length === 0) return null;

    return (
        <div className="w-full border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1e1e] shadow-lg transition-all duration-300">
            {/* 헤더 */}
            <div 
                className="flex items-center justify-between px-6 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#2d2d2d]"
                onClick={togglePanel}
            >
                <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-200">
                        📥 다운로드 관리자
                    </span>
                    {activeCount > 0 ? (
                        <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                            {activeCount}개 진행 중
                        </span>
                    ) : (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            모든 작업 완료
                        </span>
                    )}
                </div>
                
                <div className="flex items-center gap-2">
                    <button className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-transform">
                        {isPanelOpen ? '▼' : '▲'}
                    </button>
                </div>
            </div>

            {/* 리스트 영역 */}
            {isPanelOpen && (
                <div className="border-t border-gray-100 dark:border-gray-700 max-h-60 overflow-y-auto custom-scrollbar bg-gray-50 dark:bg-[#181818]">
                    <div className="p-2 space-y-2">
                        {queue.map((job) => (
                            <div key={job.id} className="flex flex-col p-3 bg-white dark:bg-[#2d2d2d] rounded-md border border-gray-200 dark:border-gray-600 shadow-sm mx-4">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate max-w-[400px]">
                                        {job.url}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-200">
                                        {job.status}
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-blue-500 transition-all duration-300"
                                        style={{ width: `${job.progress || 0}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}