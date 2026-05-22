import { Heart } from 'lucide-react'
import { type ReactElement } from 'react'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { PhotoCard } from '../gallery/PhotoCard'
import { useFavoritesViewModel } from './useFavoritesViewModel'

export const FavoritesPage = (): ReactElement => {
    const { galleryItems, selectedId, isLoading, toggleSelect, toggleFavorite, deleteMedia } =
        useFavoritesViewModel()

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center text-slate-500 dark:text-slate-400">
                <p>즐겨찾기를 불러오는 중...</p>
            </div>
        )
    }

    return (
        <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] px-5 pb-5 pt-[18px]">
            <header>
                <h1 className="m-0 text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">
                    즐겨찾기
                </h1>
                <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">
                    저장해둔 미디어 {galleryItems.length}개
                </p>
            </header>

            <div className="mt-4 min-h-0 overflow-auto pr-1">
                {galleryItems.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
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
                    <EmptyState
                        icon={<Heart size={28} strokeWidth={1.7} />}
                        title="즐겨찾기가 없습니다"
                        description="갤러리에서 하트 아이콘을 눌러 추가해보세요."
                    />
                )}
            </div>
        </section>
    )
}
