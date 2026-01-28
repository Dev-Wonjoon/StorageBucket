import { useState } from "react";
import { PhotoCard } from "../../components/ui/PhotoCard";
import { Media } from "src/shared/types";

const generateDummyData = (): Media[] => Array.from({ length: 200 }).map((_, i) => ({
    id: i,
    title: `테스트 이미지 ${i + 1}`,
    filepath: `/path/to/file_${i}`, 
    thumbnailPath: null, 
    duration: 0,
    filesize: 1024 * 1024 * 2.5,
    platformId: null,
    profileId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    author: 'test',
    platform: 'test',
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="lucide lucide-file-exclamation-point-icon lucide-file-exclamation-point"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    <p className="text-lg font-medium text-[--text-main]">표시할 미디어가 없습니다.</p>
                    <p className="text-sm mt-1">URL을 입력하여 다운로드를 시작해보세요</p>
                </div>
            )}
        </div>
    )
}