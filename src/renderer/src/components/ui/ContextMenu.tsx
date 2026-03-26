import { useEffect, useRef } from "react";
import { BaseModal } from "./BaseModal";

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

    return (
        <BaseModal onClose={onClose} position={{ x, y }} containerRef={menuRef} overlayClassName="bg-transparent">
            <div className="min-w-[160px] py-1">
                {items.map((item, i) => (
                    <button
                        key={i}
                        onClick={() => {
                            item.onClick();
                            onClose();
                        }}
                        className={`block w-full text-left px-4 py-2 text-sm border-none bg-transparent cursor-pointer hover:bg-white/10 ${
                            item.danger ? "text-red-400" : "text-[var(--text-popup)]"
                        }`}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </BaseModal>
    );
};
