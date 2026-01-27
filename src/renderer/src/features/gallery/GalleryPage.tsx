import { useState } from "react";
import { PhotoCard } from "../../components/ui/PhotoCard";
import { Media } from "src/shared/types";

const generateDummyData = (): Media[] => Array.from({ length: 8 }).map((_, i) => ({
    id: i,
    title: `테스트 이미지 ${i + 1}`,
    filepath: `/path/to/file_${i}`, 
    thumbnailPath: 'https://via.placeholder.com/300x200/1e293b/3b82f6?text=Preview', 
    duration: 0,
    filesize: 1024 * 1024 * 2.5,
    platformId: null,
    profileId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    author: null,
    platform: null,
    url: null,
}));

export const GalleryPage = () => {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [medias, setMedias] = useState<Media[]>(generateDummyData());

    const handleCardClick = (id: number) => {
        setSelectedId(id === selectedId ? null : id);
    };

    return (
        <div className="w-full h-full pb-10">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-sm text-[--text-main]">
                    갤러리
                </h2>
                <span className="text-sm text-[--text-muted]">
                    총 {medias.length}개 항목
                </span>
            </div>
            {medias.length > 0 ? (
                <div className="grid grid-col-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {medias.map((media) => (
                        <PhotoCard
                            key={media.id}
                            data={media}
                            isSelected={selectedId === media.id}
                            onClick={handleCardClick}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-[60vh] border-2 border-dashed rounded-2xl
                                border-[--border-line] text-[--text-muted]">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 mb-4 opacity-50">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H3.75A2.25 2.25 0 0 0 1.5 6v12a2.25 2.25 0 0 0 2.25 2.25Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                    <p className="text-lg font-medium text-[--text-main]">표시할 미디어가 없습니다.</p>
                    <p className="text-sm mt-1">URL을 입력하여 다운로드를 시작해보세요</p>
                </div>
            )}
        </div>
    )
}