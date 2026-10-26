import { useEffect, useId, useRef, useState } from 'react'
import { Ellipsis, FolderOpen, Pencil, Star, Tags, Trash2 } from 'lucide-react'

interface GalleryCardActionsProps {
    title: string
    isFavorite: boolean
    disabled: boolean
    mutationDisabled: boolean
    favoriteDisabledReason?: string
    onToggleFavorite: () => void
    onOpenFolder: () => void
    onEdit: (field: 'title' | 'tags') => void
    onUnregister: () => void
}

export function GalleryCardActions({
    title,
    isFavorite,
    disabled,
    mutationDisabled,
    favoriteDisabledReason,
    onToggleFavorite,
    onOpenFolder,
    onEdit,
    onUnregister
}: GalleryCardActionsProps): React.JSX.Element {
    const [open, setOpen] = useState(false)
    const [opensUp, setOpensUp] = useState(true)
    const root = useRef<HTMLDivElement>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const menu = useRef<HTMLDivElement>(null)
    const menuId = useId()
    const starLabel = title + (isFavorite ? ' 즐겨찾기 해제' : ' 즐겨찾기 추가')
    const iconButton =
        'flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-40 disabled:pointer-events-none'
    const menuItem =
        'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none disabled:opacity-40'

    function closeMenu(restore = false): void {
        setOpen(false)
        if (restore) trigger.current?.focus({ preventScroll: true })
    }
    useEffect(() => {
        if (!open) return
        menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
        const outside = (event: Event): void => {
            if (event.target instanceof Node && !root.current?.contains(event.target))
                setOpen(false)
        }
        document.addEventListener('pointerdown', outside)
        document.addEventListener('click', outside, true)
        return () => {
            document.removeEventListener('pointerdown', outside)
            document.removeEventListener('click', outside, true)
        }
    }, [open])

    return (
        <div
            ref={root}
            data-detail-trigger
            className="relative flex justify-end gap-1 border-t border-[var(--border-line)] px-2 py-1.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (!open) return
                if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeMenu(true)
                }
                if (event.key === 'Tab') closeMenu()
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault()
                    const items = Array.from(
                        menu.current?.querySelectorAll<HTMLButtonElement>(
                            'button:not(:disabled)'
                        ) ?? []
                    )
                    const index = items.findIndex((item) => item === document.activeElement)
                    const next =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? items.length - 1
                              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                                items.length
                    items[next]?.focus()
                }
            }}
        >
            <button
                type="button"
                className={
                    iconButton + (isFavorite ? ' text-amber-500' : ' text-[var(--text-muted)]')
                }
                disabled={disabled || mutationDisabled || Boolean(favoriteDisabledReason)}
                aria-label={starLabel}
                aria-pressed={isFavorite}
                title={favoriteDisabledReason || (isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가')}
                onClick={() => {
                    closeMenu()
                    onToggleFavorite()
                }}
            >
                <Star
                    className="size-[18px]"
                    fill={isFavorite ? 'currentColor' : 'none'}
                    aria-hidden="true"
                />
            </button>
            <button
                type="button"
                className={iconButton + ' text-[var(--text-muted)]'}
                disabled={disabled}
                aria-label={title + ' 파일 위치 열기'}
                title="파일 위치 열기"
                onClick={() => {
                    closeMenu()
                    onOpenFolder()
                }}
            >
                <FolderOpen className="size-[18px]" aria-hidden="true" />
            </button>
            <button
                ref={trigger}
                type="button"
                className={iconButton}
                disabled={disabled}
                aria-label={title + ' 더보기'}
                title="더보기"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => {
                    const bounds = trigger.current?.getBoundingClientRect()
                    const top = root.current?.closest('main')?.getBoundingClientRect().top ?? 0
                    setOpensUp(Boolean(bounds && bounds.top - top > 160))
                    setOpen((previous) => !previous)
                }}
            >
                <Ellipsis className="size-[18px]" aria-hidden="true" />
            </button>
            {open && (
                <div
                    ref={menu}
                    id={menuId}
                    role="menu"
                    aria-label={title + ' 카드 메뉴'}
                    className={
                        'absolute right-2 z-20 w-48 rounded-lg border border-[var(--border-line)] bg-[var(--bg-sidebar)] p-1 shadow-xl ' +
                        (opensUp ? 'bottom-full mb-1' : 'top-full mt-1')
                    }
                >
                    <button
                        type="button"
                        role="menuitem"
                        className={menuItem}
                        onClick={() => {
                            closeMenu()
                            onEdit('title')
                        }}
                    >
                        <Pencil className="size-4" aria-hidden="true" />
                        제목 편집
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={menuItem}
                        onClick={() => {
                            closeMenu()
                            onEdit('tags')
                        }}
                    >
                        <Tags className="size-4" aria-hidden="true" />
                        태그 편집
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={menuItem + ' border-t border-[var(--border-line)] text-red-500'}
                        disabled={mutationDisabled}
                        onClick={() => {
                            closeMenu(true)
                            onUnregister()
                        }}
                    >
                        <Trash2 className="size-4" aria-hidden="true" />
                        등록 해제
                    </button>
                </div>
            )}
        </div>
    )
}
