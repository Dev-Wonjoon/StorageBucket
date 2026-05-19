import { type ReactElement } from "react";
import { ContextMenu } from "@renderer/components/ui/ContextMenu";
import { TagModal } from "@renderer/components/TagModal";

interface GalleryOverlaysProps {
    contextMenu: { x: number; y: number; mediaId: number } | null;
    tagModal: { mediaIds: number[] } | null;
    selectedIds: Set<number>;
    onCloseContextMenu: () => void;
    onOpenTagModal: (mediaIds: number[]) => void;
    onDeleteMedia: (id: number) => void;
    onCloseTagModal: () => void;
    onUpdated: () => void | Promise<void>
}

export const GalleryOverlays = ({
    contextMenu,
    tagModal,
    selectedIds,
    onCloseContextMenu,
    onOpenTagModal,
    onDeleteMedia,
    onCloseTagModal,
    onUpdated
}: GalleryOverlaysProps): ReactElement => {
    return (
        <>
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={onCloseContextMenu}
                    items={[
                        {
                            label: '태그 관리',
                            onClick: () => {
                                const ids =
                                    selectedIds.size > 0
                                        ? [...selectedIds]
                                        : [contextMenu.mediaId]

                                onOpenTagModal(ids)
                            }
                        },
                        {
                            label: '삭제',
                            danger: true,
                            onClick: () => onDeleteMedia(contextMenu.mediaId)
                        }
                    ]}
                />
            )}

            {tagModal && (
                <TagModal
                    mediaIds={tagModal.mediaIds}
                    onClose={onCloseTagModal}
                    onUpdated={onUpdated}
                />
            )}
        </>
    )
}