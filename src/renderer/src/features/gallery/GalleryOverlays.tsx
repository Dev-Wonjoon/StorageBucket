import { type ReactElement } from 'react'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { TagModal } from '@renderer/components/TagModal'
import { type DownloadLog, type GalleryItem } from 'src/shared/types'

interface GalleryOverlaysProps {
    contextMenu: { x: number; y: number; mediaId: number } | null
    galleryItems: GalleryItem[]
    tagModal: { mediaIds: number[] } | null
    selectedIds: Set<number>
    onCloseContextMenu: () => void
    onOpenTagModal: (mediaIds: number[]) => void
    onDeleteMedia: (id: number) => void
    onOpenDownloadLog: (log: DownloadLog) => void
    onCloseTagModal: () => void
    onUpdated: () => void | Promise<void>
}

export const GalleryOverlays = ({
    contextMenu,
    galleryItems,
    tagModal,
    selectedIds,
    onCloseContextMenu,
    onOpenTagModal,
    onDeleteMedia,
    onOpenDownloadLog,
    onCloseTagModal,
    onUpdated
}: GalleryOverlaysProps): ReactElement => {
    const contextItem = contextMenu
        ? galleryItems?.find((item) => item.media.id === contextMenu.mediaId)
        : undefined

    const contextMedia = contextItem?.media
    const isQueueItem = Boolean(contextItem?.downloadStatus)
    const hasUrl = Boolean(contextMedia?.url)
    const hasLog = Boolean(contextItem?.downloadLog || contextItem?.errorMessage)

    const selectedMediaIds = 
        selectedIds.size > 0
            ? [...selectedIds].filter((id) => id > 0)
            : contextMenu && contextMenu.mediaId > 0
                ? [contextMenu.mediaId]
                : []


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
                            disabled: selectedMediaIds.length === 0,
                            onClick: () => {
                                const ids =
                                    selectedIds.size > 0 ? [...selectedIds] : [contextMenu.mediaId]

                                onOpenTagModal(ids)
                            }
                        },
                        {
                            label: '다운로드 재시도',
                            disabled: !hasUrl,
                            onClick: () => {
                                if(!contextMedia?.url) return
                                void window.api?.downloadVideo?.(contextMedia.url)
                            }
                        },
                        {
                            label: '로그 정보',
                            disabled: !hasLog,
                            onClick: () => {
                                if(contextItem?.downloadLog) {
                                    onOpenDownloadLog(contextItem.downloadLog)
                                    return
                                }

                                if(contextItem?.errorMessage) {
                                    onOpenDownloadLog({
                                        summary: contextItem.errorMessage,
                                        steps: ['저장된 상세 로그가 없습니다.'],
                                        raw: contextItem.errorMessage
                                    })
                                }
                            }
                        },
                        {
                            label: '원본 페이지 열기',
                            disabled: !hasUrl,
                            onClick: () => {
                                if(!contextMedia?.url) return
                                window.open(contextMedia.url, '_blank', 'noopener,noreferrer')
                            }
                        },
                        {
                            label: isQueueItem ? "목록에서 제거" : '삭제',
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
