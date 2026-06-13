// 카드 하단에 배치되는 아이콘 액션 버튼 목록을 공통 스타일로 렌더링함.
// 각 화면은 TSX를 직접 반복하지 않고, items 배열로 아이콘과 동작만 남김.

import { type MouseEvent, type ReactElement } from 'react'
import { IconButton } from './IconButton'

export interface CardActionButtonItem {
    key: string
    title: string
    icon: ReactElement
    active?: boolean
    disabled?: boolean
    hidden?: boolean
    className?: string
    onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

interface CardActionButtonsProps {
    items: CardActionButtonItem[]
    size?: 'sm' | 'md'
    align?: 'start' | 'end'
    className?: string
}

export const CardActionButtons = ({
    items,
    size = 'sm',
    align = 'end',
    className = ''
}: CardActionButtonsProps): ReactElement | null => {
    const visibleItems = items.filter((item) => !item.hidden)

    if (visibleItems.length === 0) return null

    return (
        <div
            className={`flex gap-1 ${
                align === 'end' ? 'justify-end' : 'justify-start'
            } ${className}`}
        >
            {visibleItems.map((item) => (
                <IconButton
                    key={item.key}
                    size={size}
                    active={item.active}
                    disabled={item.disabled}
                    onClick={item.onClick}
                    title={item.title}
                    aria-label={item.title}
                    className={item.className}
                >
                    {item.icon}
                </IconButton>
            ))}
        </div>
    )
}
