// src/renderer/src/features/gallery/GalleryPage.tsx

import { PhotoCard } from "./PhotoCard";
import { useGalleryViewModel } from "./useGalleryViewModel";

export const GalleryPage = () => {
    const { medias, selectedId, isLoading, toggleSelect } = useGalleryViewModel();

    if (isLoading && medias.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-[--text-muted]">
                <div className="flex flex-col items-center gap-2">
                    <p>미디어를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full pb-10">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm text-[--text-main]">갤러리</h2>
                <span className="text-sm text-[--text-muted]">총 {medias.length}개 항목</span>
            </div>
            {medias.length > 0 ? (
                <div className="grid grid-col-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {medias.map((media) => (
                        <PhotoCard
                            key={media.id}
                            data={media}
                            isSelected={selectedId === media.id}
                            onClick={toggleSelect}  // ✅ 변경
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-[60vh] border-2 border-dashed rounded-2xl
                                border-[--border-line] text-[--text-muted]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
                    </svg>
                    <p className="text-lg font-medium text-[--text-main]">표시할 미디어가 없습니다.</p>
                    <p className="text-sm mt-1">URL을 입력하여 다운로드를 시작해보세요</p>
                </div>
            )}
        </div>
    );
};