import { Media } from "src/shared/types";
import { usePhotoCardViewModel } from "./usePhotoCardViewModel";

interface PhotoCardProps {
    data: Media;
    isSelected: boolean;
    onClick: (id: number) => void;
    onToggleFavorite: (id: number) => void;
    onDelete: (id: number) => void;
    isDownloading?: boolean;
    progress?: number;
    speed?: string;
    eta?: string;
}

export const PhotoCard = ({ data, isSelected, onClick, onToggleFavorite, onDelete, isDownloading = false, progress, speed, eta }: PhotoCardProps) => {
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
                    : 'hover:border-[--border-line] hover:scale-[1.02] hover:shadow-lg'
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

                <p className="text-xs mb-1 truncate text-[--text-muted]">
                    {isDownloading
                        ? [
                            progress !== undefined ? `${progress.toFixed(1)}%` : '대기 중',
                            speed,
                            eta ? `남은 시간 ${eta}` : null,
                        ].filter(Boolean).join(' · ')
                        : new Date(data.createdAt).toLocaleDateString()
                    }
                </p>
                <div className="justify-end flex">
                    {/* 버튼 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(data.id);
                        }}
                        className="rounded hover:bg-[--bg-active] text-[--text-muted] hover:text-red-500 transition-colors"
                        title="즐겨찾기"
                    >
                        {data.isFavorite ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-5 text-yellow-500">
                                <path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" />
                            </svg>

                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                            </svg>
                        )}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(data.id);
                        }}
                        className="p-1 rounded hover:bg-[--bg-active] text-[--text-muted] hover:text-red-500 transition-colors"
                        title="삭제"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" className="size-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}