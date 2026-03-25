import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ContextMenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export const ContextMenu = ({ x, y, items, onClose }: ContextMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);

    // ESC 키로 닫기
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleEsc);
        return () => document.removeEventListener("keydown", handleEsc);
    }, [onClose]);

    // 화면 밖으로 나가지 않도록 위치 보정
    useEffect(() => {
        if (!menuRef.current) return;
        const rect = menuRef.current.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menuRef.current.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menuRef.current.style.top = `${y - rect.height}px`;
        }
    }, [x, y]);

    return createPortal(
        <>
            {/* 오버레이 */}
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 99998,
                    backgroundColor: "transparent",
                }}
                onClick={onClose}
            />
            {/* 메뉴 */}
            <div
                ref={menuRef}
                style={{
                    position: "fixed",
                    left: x,
                    top: y,
                    zIndex: 99999,
                    minWidth: 160,
                    backgroundColor: "var(--bg-popup)",
                    borderRadius: 8,
                    padding: "4px 0",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {items.map((item, i) => (
                    <button
                        key={i}
                        onClick={() => {
                            item.onClick();
                            onClose();
                        }}
                        style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 16px",
                            fontSize: 14,
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: item.danger
                                ? "#f87171"
                                : "var(--text-popup)",
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor =
                                "rgba(255,255,255,0.1)")
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                                "transparent")
                        }
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </>,
        document.body
    );
};
