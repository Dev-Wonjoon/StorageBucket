import { Heart } from 'lucide-react'
import { type ReactElement } from 'react'
import { PhotoCard } from '../gallery/PhotoCard'
import { useFavoritesViewModel } from './useFavoritesViewModel'

export const FavoritesPage = (): ReactElement => {
    const { galleryItems, selectedId, isLoading, toggleSelect, toggleFavorite, deleteMedia } =
        useFavoritesViewModel()

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
                <p>즐겨찾기를 불러오는 중...</p>
            </div>
        )
    }

    return (
        <section className="sb-library">
            <header>
                <h1 className="sb-page-title">즐겨찾기</h1>
                <p className="sb-page-subtitle">저장해둔 미디어 {galleryItems.length}개</p>
            </header>

            <div className="sb-gallery-scroll mt-4">
                {galleryItems.length > 0 ? (
                    <div className="sb-media-grid">
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
                    <div className="sb-empty-state">
                        <Heart size={28} strokeWidth={1.7} />
                        <p className="mt-3 text-lg font-semibold text-[var(--text-main)]">
                            즐겨찾기가 없습니다
                        </p>
                        <p className="mt-1 text-sm">갤러리에서 하트 아이콘을 눌러 추가해보세요.</p>
                    </div>
                )}
            </div>
        </section>
    )
}
