import { PhotoCard } from "../gallery/PhotoCard";
import { useFavoritesViewModel } from "./useFavoritesViewModel";

export const FavoritesPage = () => {
    const { galleryItems, selectedId, isLoading, toggleSelect, toggleFavorite, deleteMedia } = useFavoritesViewModel();

    if(isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-[--text-muted]">
                <p>즐겨찾기를 불러오는 중...</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full pb-10">
            <div className="flex items-center justify-end mb-6">
                <span className="text-sm text-[--text-muted]">총 {galleryItems.length}개 항목</span>
            </div>
            {galleryItems.length > 0 ? (
                <div className="grid grid-col-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {galleryItems.map((media) => (
                        <PhotoCard
                            key={media.id}
                            data={media}
                            isSelected={selectedId === media.id}
                            onClick={toggleSelect}
                            onToggleFavorite={toggleFavorite}
                            onDelete={deleteMedia}
                        />
                    ))}
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-[60vh] border-2 border-dashed rounded-2xl
                                border-[--border-line] text-[--text-muted]">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="size-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                    </svg>
                    <p className="text-lg font-medium text-[--text-main]">즐겨찾기가 없습니다.</p>
                    <p className="text-sm mt-1">갤러리에서 별 아이콘을 눌러 추가해보세요</p>
                </div>
            )}
        </div>
    );
}