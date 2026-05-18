import { FileWarning, Heart, Loader2, Star, Trash2 } from 'lucide-react'
import { type ReactElement } from 'react'
import { Media } from 'src/shared/types'
import { usePhotoCardViewModel } from './usePhotoCardViewModel'

interface PhotoCardProps {
    data: Media
    isSelected: boolean
    onClick: (id: number, e: React.MouseEvent) => void
    onContextMenu?: (e: React.MouseEvent, mediaId: number) => void
    onToggleFavorite: (id: number) => void
    onDelete: (id: number) => void
    isDownloading?: boolean
    progress?: number
    speed?: string
    eta?: string
    layout?: 'grid' | 'list'
}

const formatDate = (value: Date | string): string => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

export const PhotoCard = ({
    data,
    isSelected,
    onClick,
    onContextMenu,
    onToggleFavorite,
    onDelete,
    isDownloading = false,
    progress,
    speed,
    eta,
    layout = 'grid'
}: PhotoCardProps): ReactElement => {
    const { imageUrl, displayTime, hasThumbnail, handleClick } = usePhotoCardViewModel(data)
    const platform = data.platform || (isDownloading ? 'Queue' : 'Media')

    return (
        <article
            onClick={(e) => !isDownloading && handleClick(onClick, e)}
            onContextMenu={(e) => {
                if (!isDownloading && onContextMenu) {
                    e.preventDefault()
                    onContextMenu(e, data.id)
                }
            }}
            className={[
                'sb-media-card',
                layout === 'list' ? 'is-list' : '',
                isSelected ? 'is-selected' : '',
                isDownloading ? 'is-disabled' : ''
            ].join(' ')}
        >
            <div className="sb-media-thumb">
                {isDownloading ? (
                    <div className="sb-thumb-empty">
                        <Loader2 size={28} strokeWidth={2} className="animate-spin" />
                    </div>
                ) : hasThumbnail && imageUrl ? (
                    <img src={imageUrl} alt={data.title} loading="lazy" />
                ) : (
                    <div className="sb-thumb-empty">
                        <FileWarning size={28} strokeWidth={1.8} />
                    </div>
                )}

                <span className="sb-pill sb-thumb-source">{platform}</span>
                {(displayTime || isDownloading) && (
                    <span className="sb-pill sb-thumb-duration">
                        {isDownloading ? '진행 중' : displayTime}
                    </span>
                )}
            </div>

            <div className="sb-card-body">
                <h3 className="sb-media-title" title={data.title}>
                    {data.title}
                </h3>
                <div className="sb-media-meta">
                    <span className="truncate">{data.author || 'unknown'}</span>
                    <span className="flex-none">
                        {isDownloading
                            ? [
                                  progress !== undefined ? `${progress.toFixed(0)}%` : '대기',
                                  speed,
                                  eta ? `${eta} 남음` : null
                              ]
                                  .filter(Boolean)
                                  .join(' · ')
                            : formatDate(data.createdAt)}
                    </span>
                </div>

                {!isDownloading && (
                    <div className="sb-card-actions">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation()
                                onToggleFavorite(data.id)
                            }}
                            className="sb-icon-button h-8 w-8"
                            title={data.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
                            aria-label={data.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
                        >
                            {data.isFavorite ? (
                                <Star
                                    size={16}
                                    fill="currentColor"
                                    className="text-[var(--color-coral)]"
                                />
                            ) : (
                                <Heart size={16} />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete(data.id)
                            }}
                            className="sb-icon-button h-8 w-8"
                            title="삭제"
                            aria-label="삭제"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                )}
            </div>

            {isDownloading && (
                <div className="sb-download-progress">
                    <div className="sb-progress-copy">
                        <span>
                            {progress !== undefined ? `${progress.toFixed(0)}%` : '대기 중'}
                        </span>
                        <span>{speed || eta || '준비 중'}</span>
                    </div>
                    <div className="sb-progress-track">
                        <i style={{ width: `${Math.max(0, Math.min(progress || 0, 100))}%` }} />
                    </div>
                </div>
            )}
        </article>
    )
}
