import { FileWarning, Loader2, Star, Trash2 } from 'lucide-react'
import { type ReactElement } from 'react'
import { IconButton } from '@renderer/components/ui/IconButton'
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
            onClick={(e) => {
                e.stopPropagation()
                if (!isDownloading) handleClick(onClick, e)
            }}
            onContextMenu={(e) => {
                if (!isDownloading && onContextMenu) {
                    e.preventDefault()
                    onContextMenu(e, data.id)
                }
            }}
            className={[
                'group min-w-0 overflow-hidden rounded-lg border bg-white transition-[border-color,box-shadow,transform] dark:bg-slate-900',
                layout === 'list'
                    ? 'grid grid-cols-[168px_minmax(0,1fr)_auto] items-stretch max-[840px]:grid-cols-[132px_minmax(0,1fr)]'
                    : '',
                isSelected
                    ? 'border-indigo-500 shadow-[0_0_0_2px_rgb(238,242,255)] dark:shadow-[0_0_0_2px_rgb(49,46,129)]'
                    : 'border-slate-200 dark:border-slate-700',
                isDownloading
                    ? 'opacity-70'
                    : 'cursor-pointer hover:-translate-y-px hover:border-slate-300 hover:shadow-lg dark:hover:border-slate-600'
            ].join(' ')}
        >
            <div
                className={`relative overflow-hidden bg-slate-200 dark:bg-slate-800 ${layout === 'list' ? 'min-h-[104px]' : 'aspect-[16/10]'}`}
            >
                {isDownloading ? (
                    <div className="grid h-full min-h-[118px] w-full place-items-center bg-gradient-to-br from-slate-500 via-amber-400 to-emerald-900 text-white">
                        <Loader2 size={28} strokeWidth={2} className="animate-spin" />
                    </div>
                ) : hasThumbnail && imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={data.title}
                        loading="lazy"
                        className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.035]"
                    />
                ) : (
                    <div className="grid h-full min-h-[118px] w-full place-items-center bg-gradient-to-br from-slate-500 via-amber-400 to-emerald-900 text-white">
                        <FileWarning size={28} strokeWidth={1.8} />
                    </div>
                )}

                <span className="absolute left-2 top-2 inline-flex h-[22px] items-center rounded-md bg-slate-950/75 px-2 text-[11px] font-bold text-white">
                    {platform}
                </span>
                {(displayTime || isDownloading) && (
                    <span className="absolute bottom-2 right-2 inline-flex h-[22px] items-center rounded-md bg-slate-950/75 px-2 text-[11px] font-bold text-white">
                        {isDownloading ? '진행 중' : displayTime}
                    </span>
                )}
            </div>

            <div className="grid gap-2 p-2.5">
                <h3
                    className="m-0 truncate text-[13px] font-bold leading-snug text-slate-950 dark:text-slate-100"
                    title={data.title}
                >
                    {data.title}
                </h3>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                    <div className="flex justify-end gap-1">
                        <IconButton
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation()
                                onToggleFavorite(data.id)
                            }}
                            title={data.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
                            aria-label={data.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'}
                        >
                            {data.isFavorite ? (
                                <Star
                                    size={16}
                                    fill="currentColor"
                                    className="text-rose-600 dark:text-rose-400"
                                />
                            ) : (
                                <Star size={16} />
                            )}
                        </IconButton>
                        <IconButton
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete(data.id)
                            }}
                            title="삭제"
                            aria-label="삭제"
                        >
                            <Trash2 size={16} />
                        </IconButton>
                    </div>
                )}
            </div>

            {isDownloading && (
                <div className="grid gap-2 border-t border-slate-200 bg-rose-50 p-2.5 dark:border-slate-800 dark:bg-rose-950">
                    <div className="flex justify-between gap-2 text-xs font-bold text-rose-600 dark:text-rose-300">
                        <span>
                            {progress !== undefined ? `${progress.toFixed(0)}%` : '대기 중'}
                        </span>
                        <span>{speed || eta || '준비 중'}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-rose-200 dark:bg-rose-900">
                        <div
                            className="h-full rounded-full bg-rose-600 dark:bg-rose-400"
                            style={{ width: `${Math.max(0, Math.min(progress || 0, 100))}%` }}
                        />
                    </div>
                </div>
            )}
        </article>
    )
}
