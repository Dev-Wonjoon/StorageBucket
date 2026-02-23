import { useMemo } from "react";
import { Media } from "src/shared/types";

interface PhotoCardProps {
    data: Media;
    isSelected: boolean;
    onClick: (id: number) => void;
    // ... 나머지 props (onInfo 등은 아직 안 쓰이므로 생략 가능)
}

export const PhotoCard = ({ data, isSelected, onClick }: PhotoCardProps) => {
    const hasThumbnail = Boolean(data.thumbnailPath);
    
    const imageUrl = useMemo(() => {
        if(!data.thumbnailPath) return null;
        // 윈도우 경로 역슬래시 처리
        const cleanPath = data.thumbnailPath.replace(/\\/g, '/');
        return `media:///${cleanPath}`;
    }, [data.thumbnailPath]);

    const formatTime = (seconds: number) => {
        if(!seconds || seconds <= 0 || isNaN(seconds)) return null;
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    const displayTime = useMemo(() => formatTime(data.duration), [data.duration]);

    return (
        <div
            onClick={() => onClick(data.id)}
            className={`
                group relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all duration-200 shadow-sm
                bg-[var(--bg-sidebar)]  /* 카드 배경색 */
                ${isSelected 
                    ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30 scale-95 shadow-md' 
                    : 'border-transparent hover:border-[var(--border-line)] hover:scale-[1.02] hover:shadow-lg'
                }
            `}
        >
            {/* 1. 썸네일 영역 */}
            <div className="aspect-video relative bg-[var(--bg-active)] overflow-hidden">
                {hasThumbnail && imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={data.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full text-[var(--text-muted)]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
                        </svg>
                        <span className="text-[10px] mt-2 opacity-60 font-medium">No Preview</span>
                    </div>
                )}

                {/* 영상 길이 배지 (항상 어둡게 유지하거나 테마 적용 가능) */}
                {/* 영상 위 글자는 보통 가독성을 위해 테마 상관없이 어두운 배경 + 흰 글씨를 씁니다 */}
                {displayTime && (
                    <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-medium backdrop-blur-[2px]">
                        {displayTime}
                    </div>
                )}
            </div>

            {/* 2. 정보 영역 (하단) */}
            <div className="p-3 border-t border-[var(--border-line)]">
                {/* 제목: 메인 텍스트 색상 */}
                <h3 className="text-sm font-medium truncate text-[var(--text-main)]" title={data.title}>
                    {data.title}
                </h3>
                {/* 날짜: 흐린 텍스트 색상 */}
                <p className="text-xs mt-1 truncate text-[var(--text-muted)]">
                    {new Date(data.createdAt).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
};