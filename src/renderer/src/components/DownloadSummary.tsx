interface DownloadSummaryProps {
    activeCount: number;
    totalProgress: number;
    onClick: () => void;
    isExpanded: boolean;
}

export const DownloadSummary = ({ activeCount, totalProgress, onClick, isExpanded }): DownloadSummaryProps => {
    return (
        <div
            onClick={onClick}
            className="bg-[--bg-sidebar] border border-[--border-line] rounded-xl p-4 cursor-pointer hover:border-[--color-primary] transition-colors shadow-sm relative overflow-hidden group">
            <div
                className="absolute left-0 top-0 bottom-0 bg-[--color-primary]/5 transition-all duration-500 ease-out"            
                style={{ width: `${totalProgress}` }}/>
            <div className="relative flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${activeCount > 0 ? 'bg-[--color-primary]/10 text-[--color-primary]' : 'bg-'}`}>

                    </div>
                </div>
            </div>
        </div>
    );
};