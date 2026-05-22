import { type ReactNode, type ReactPortal, type RefObject, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface BaseModalProps {
    onClose?: () => void
    closeOnOverlay?: boolean
    position?: 'center' | { x: number; y: number }
    containerRef?: RefObject<HTMLDivElement | null>
    overlayClassName?: string
    children: ReactNode
}

export const BaseModal = ({
    onClose,
    closeOnOverlay = true,
    position = 'center',
    containerRef,
    overlayClassName = 'bg-black/50',
    children
}: BaseModalProps): ReactPortal => {
    // ESC 키로 닫기
    useEffect(() => {
        if (!onClose) return
        const handleEsc = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', handleEsc)
        return () => document.removeEventListener('keydown', handleEsc)
    }, [onClose])

    const isCenter = position === 'center'

    return createPortal(
        <>
            {/* 오버레이 */}
            <div
                className={`fixed inset-0 z-[99998] ${overlayClassName}`}
                onClick={closeOnOverlay ? onClose : undefined}
            />
            {/* 컨테이너 */}
            {isCenter ? (
                <div className="pointer-events-none fixed inset-0 z-[99999] flex items-center justify-center">
                    <div
                        className="pointer-events-auto overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {children}
                    </div>
                </div>
            ) : (
                <div
                    ref={containerRef}
                    className="fixed z-[99999] rounded-lg bg-white shadow-2xl dark:bg-slate-900"
                    style={{
                        left: (position as { x: number; y: number }).x,
                        top: (position as { x: number; y: number }).y
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {children}
                </div>
            )}
        </>,
        document.body
    )
}
