import { Media } from "src/shared/types";
import { usePhotoCardViewModel } from "./usePhotoCardViewModel";

interface PhotoCardProps {
    data: Media;
    isSelected: boolean;
    onClick: (id: number) => void;
    isDownloading?: boolean;
    progress?: number;
    speed?: string;
    eta?: string;
}

export const PhotoCard = ({ data, isSelected, onClick, isDownloading = false, progress, speed, eta }: PhotoCardProps) => {
    const { imageUrl, displayTime, hasThumbnail, handleClick, handleContextMenu } = usePhotoCardViewModel(data);

    return (
        <div
            onClick={() => !isDownloading && handleClick(onClick)}
            onContextMenu={(e) => !isDownloading && handleContextMenu(e)}
            className={`
                group relative rounded-xl overflow-hidden border-2 transition-all duration-200 shadow-sm
                bg-[--bg-sidebar]
                ${isDownloading ? 'opacity-50 cursor-default' : 'cursor-pointer'}
                ${isSelected
                    ? 'border-[--color-primary] ring-2 ring-[--color-primary]/30 scale-95 shadow-md'
                    : 'border-transparent hover:border-[--border-line] hover:scale-[1.02] hover:shadow-lg'
                }
            `}
        >
            <div className="aspect-video relative bg-[--bg-active] overflow-hidden">
                {isDownloading ? (
                    <div className="flex flex-col items-center justify-center w-full h-full text-[--text-muted]">
                        <svg
                            xmlns="http://www.w3.org/2000/svg" width="28" height="28"
                            viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className="animate-spin"
                        >
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        <span className="text-[10px] mt-2 opacity-60 font-medium">다운로드 중...</span>
                    </div>
                ) : hasThumbnail && imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={data.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full text-[--text-muted]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>
                            <path d="M12 9v4"/><path d="M12 17h.01"/>
                        </svg>
                        <span className="text-[10px] mt-2 opacity-60 font-medium">No Preview</span>
                    </div>
                )}

                {isDownloading && progress !== undefined && (
                    <div className="absolute bottom-0 left-0 w-full h-1 bg-black/20">
                        <div
                            className="h-full bg-[--color-primary] transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}

                {!isDownloading && displayTime && (
                    <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-medium backdrop-blur-[2px]">
                        {displayTime}
                    </div>
                )}
            </div>

            <div className="p-3 border-t border-[--border-line]">
                <h3 className="text-sm font-medium truncate text-[--text-main]" title={data.title}>
                    {data.title}
                </h3>
                <p className="text-xs mt-1 truncate text-[--text-muted]">
                    {isDownloading
                        ? [
                            progress !== undefined ? `${progress.toFixed(1)}%` : '대기 중',
                            speed,
                            eta ? `남은 시간 ${eta}` : null,
                          ].filter(Boolean).join(' · ')
                        : new Date(data.createdAt).toLocaleDateString()
                    }
                </p>
            </div>
        </div>
    );
}