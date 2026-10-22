import { FileImage, LoaderCircle, Star, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { Media } from '../../../../../shared/types'
import { useMediaCardViewModel } from './useMediaCardViewModel'

interface MediaCardProps {
    data: Media
    variant?: 'default' | 'compact'
    isSelected?: boolean
    onClick?: (id: number, event: MouseEvent) => void
    onContextMenu?: (event: MouseEvent, mediaId: number) => void
    onToggleFavorite?: (id: number) => void
    onDelete?: (id: number) => void
    isDownloading?: boolean
    progress?: number
}

export function MediaCard({
    data,
    variant = 'default',
    isSelected = false,
    onClick,
    onContextMenu,
    onToggleFavorite,
    onDelete,
    isDownloading = false,
    progress
}: MediaCardProps): React.JSX.Element {
    const { imageUrl, displayTime, handleClick } = useMediaCardViewModel(data)
    return (
        <div
            onClick={
                onClick
                    ? (event) => {
                          if (!isDownloading) handleClick(onClick, event)
                      }
                    : undefined
            }
            onContextMenu={
                onContextMenu
                    ? (event) => {
                          if (!isDownloading) onContextMenu(event, data.id)
                      }
                    : undefined
            }
            className={`group relative rounded-xl overflow-hidden border-2 transition-all duration-200 shadow-sm bg-[var(--bg-sidebar)]
        ${isDownloading ? 'opacity-50 cursor-default' : onClick ? 'cursor-pointer' : ''}
        ${isSelected ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30 scale-95 shadow-md' : 'border-transparent hover:border-[var(--border-line)] hover:scale-[1.02] hover:shadow-lg'}`}
        >
            <div className="aspect-video relative bg-[var(--bg-active)] overflow-hidden">
                {isDownloading ? (
                    <div className="flex flex-col items-center justify-center w-full h-full text-[var(--text-muted)]">
                        <LoaderCircle className="size-7 animate-spin" />
                        <span className="text-[10px] mt-2">다운로드 중...</span>
                    </div>
                ) : imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={data.title}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center w-full h-full text-[var(--text-muted)]">
                        <FileImage className="size-6" />
                        <span className="text-[10px] mt-2 opacity-60">No Preview</span>
                    </div>
                )}
                {isDownloading && progress !== undefined && (
                    <div className="absolute bottom-0 left-0 w-full h-1 bg-black/20">
                        <div
                            className="h-full bg-[var(--color-primary)] transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}
                {!isDownloading && displayTime && (
                    <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                        {displayTime}
                    </span>
                )}
            </div>
            <div className="p-3 border-t border-[var(--border-line)]">
                <h3
                    className="text-sm font-medium truncate text-[var(--text-main)]"
                    title={data.title}
                >
                    {data.title}
                </h3>
                <p className="text-xs mt-1 truncate text-[var(--text-muted)]">
                    {variant === 'compact'
                        ? [data.author, data.platform].filter(Boolean).join(' · ')
                        : isDownloading
                          ? progress !== undefined
                              ? `${progress.toFixed(1)}%`
                              : '대기 중'
                          : new Date(data.createdAt).toLocaleDateString()}
                </p>
                {(onToggleFavorite || onDelete) && (
                    <div className="flex justify-end">
                        {onToggleFavorite && (
                            <button
                                type="button"
                                title="즐겨찾기"
                                disabled={isDownloading}
                                aria-pressed={Boolean(data.isFavorite)}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onToggleFavorite(data.id)
                                }}
                                className="p-1 rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)]"
                            >
                                <Star
                                    className={`size-5 ${data.isFavorite ? 'text-yellow-500 fill-current' : ''}`}
                                />
                            </button>
                        )}
                        {onDelete && (
                            <button
                                type="button"
                                title="삭제"
                                disabled={isDownloading}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onDelete(data.id)
                                }}
                                className="p-1 rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-red-500"
                            >
                                <Trash2 className="size-5" />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
