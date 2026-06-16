import { type ReactElement, useEffect, useRef } from 'react'
import { BaseModal } from './BaseModal'

interface ContextMenuItem {
    label: string
    onClick: () => void
    danger?: boolean
    disabled?: boolean
}

interface ContextMenuProps {
    x: number
    y: number
    items: ContextMenuItem[]
    onClose: () => void
}

export const ContextMenu = ({ x, y, items, onClose }: ContextMenuProps): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null)

    // 화면 밖으로 나가지 않도록 위치 보정
    useEffect(() => {
        if (!menuRef.current) return
        const rect = menuRef.current.getBoundingClientRect()
        if (rect.right > window.innerWidth) {
            menuRef.current.style.left = `${x - rect.width}px`
        }
        if (rect.bottom > window.innerHeight) {
            menuRef.current.style.top = `${y - rect.height}px`
        }
    }, [x, y])

    return (
        <BaseModal
            onClose={onClose}
            position={{ x, y }}
            containerRef={menuRef}
            overlayClassName="bg-transparent"
        >
            <div className="min-w-[160px] py-1">
                {items.map((item, i) => (
                    <button
                        key={i}
                        type="button"
                        disabled={item.disabled}
                        onClick={() => {
                            if (item.disabled) return
                            item.onClick()
                            onClose()
                        }}
                        className={`block w-full border-none bg-transparent px-4 py-2 text-left text-sm ${item.disabled
                                ? 'cursor-not-allowed text-slate-400 opacity-60 dark:text-slate-600'
                                : `cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 ${item.danger
                                    ? 'text-rose-500 dark:text-rose-400'
                                    : 'text-slate-950 dark:text-slate-100'
                                }`
                            }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </BaseModal>
    )
}
