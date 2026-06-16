import { type ReactElement } from 'react'
import { ExternalLink, MoreHorizontal, Tags, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { Chip } from '@renderer/components/ui/Chip'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { IconButton } from '@renderer/components/ui/IconButton'
import { Media } from 'src/shared/types'
import { formatBytes, getImageUrl } from './galleryFormatters'

interface GalleryDetailPanelProps {
    media?: Media | null
    onDelete: (id: number) => void
    onOpenTagModal: (ids: number[]) => void
    onFilterAuthor: (author: string) => void
}

export const GalleryDetailPanel = ({
    media,
    onDelete,
    onOpenTagModal,
    onFilterAuthor
}: GalleryDetailPanelProps): ReactElement => {
    const imageUrl = getImageUrl(media)

    return (
        <aside
            className="absolute right-0 top-0 z-20 grid h-full min-h-0 w-80 grid-rows-[auto_minmax(0,1fr)_auto] border-l border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 max-[1180px]:hidden"
            aria-label="선택한 미디어 상세"
            onClick={(e) => e.stopPropagation()}
        >
            <header className="flex h-[68px] items-center justify-between gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
                <strong className="text-sm">상세 정보</strong>
                <IconButton title="더보기" aria-label="더보기">
                    <MoreHorizontal size={18} strokeWidth={1.8} />
                </IconButton>
            </header>

            <div className="min-h-0 overflow-auto p-4">
                {media ? (
                    <>
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt={`${media.title} 미리보기`}
                                    className="block aspect-[16/10] w-full object-contain"
                                />
                            ) : (
                                <div className="grid aspect-[16/10] w-full place-items-center bg-gradient-to-br from-slate-500 via-amber-400 to-emerald-900 text-white" />
                            )}
                        </div>

                        <h2 className="my-3.5 mb-1 text-lg leading-snug text-slate-950 dark:text-slate-100">
                            {media.title}
                        </h2>
                        <p
                            className="mb-4 truncate text-xs text-slate-500 dark:text-slate-400"
                            title={media.url || media.filepath}
                        >
                            {media.url || media.filepath || '저장 위치 없음'}
                        </p>

                        <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700">
                            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 bg-white p-2.5 text-[13px] dark:bg-slate-900">
                                <span className="text-slate-500 dark:text-slate-400">플랫폼</span>
                                <strong>{media.platform || '미분류'}</strong>
                            </div>

                            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 bg-white p-2.5 text-[13px] dark:bg-slate-900">
                                <span className="text-slate-500 dark:text-slate-400">작성자</span>
                                {media.author ? (
                                    <button
                                        type="button"
                                        className="truncate text-left font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                                        onClick={() => onFilterAuthor(media.author!)}
                                        title={`${media.author} 항목만 보기`}
                                    >
                                        {media.author}
                                    </button>
                                ) : (
                                    <strong>unknown</strong>
                                )}
                            </div>

                            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 bg-white p-2.5 text-[13px] dark:bg-slate-900">
                                <span className="text-slate-500 dark:text-slate-400">
                                    파일 크기
                                </span>
                                <strong>{formatBytes(media.filesize)}</strong>
                            </div>

                            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2.5 bg-white p-2.5 text-[13px] dark:bg-slate-900">
                                <span className="text-slate-500 dark:text-slate-400">저장일</span>
                                <strong>
                                    {new Date(media.createdAt).toLocaleDateString('ko-KR')}
                                </strong>
                            </div>
                        </div>

                        <div className="mb-2 mt-[18px] text-xs font-extrabold uppercase text-slate-500 dark:text-slate-400">
                            Tags
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <Chip active>{media.platform || 'media'}</Chip>
                            {media.isFavorite && <Chip>즐겨찾기</Chip>}
                            <Chip>미분류</Chip>
                        </div>
                    </>
                ) : (
                    <EmptyState
                        title="선택한 미디어가 없습니다"
                        description="카드를 선택하면 상세 정보가 표시됩니다."
                        className="h-full min-h-0"
                    />
                )}
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                <Button
                    variant="primary"
                    size="md"
                    type="button"
                    disabled={!media?.filepath}
                    onClick={() =>
                        media?.filepath &&
                        window.api?.showItemInFolder?.(media.id)
                    }
                >
                    <ExternalLink size={16} strokeWidth={1.8} />
                    열기
                </Button>

                <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    disabled={!media}
                    onClick={() => media && onOpenTagModal([media.id])}
                >
                    <Tags size={16} strokeWidth={1.8} />
                    태그
                </Button>

                <Button
                    variant="secondary"
                    size="md"
                    type="button"
                    disabled={!media}
                    onClick={() => media && onDelete(media.id)}
                >
                    <Trash2 size={16} strokeWidth={1.8} />
                    삭제
                </Button>
            </div>
        </aside>
    )
}
