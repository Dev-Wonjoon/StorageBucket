import { type ReactElement } from "react";
import { ExternalLink, MoreHorizontal, Tags, Trash2 } from "lucide-react";
import { Media } from "src/shared/types";
import { formatBytes, getImageUrl } from "./galleryFormatters";

interface GalleryDetailPanelProps {
    media?: Media | null;
    onDelete: (id: number) => void
    onOpenTagModal: (ids: number[]) => void
    onFilterAuthor: (author: string) => void
}

export const GalleryDetailPanel = ({
    media,
    onDelete,
    onOpenTagModal,
    onFilterAuthor
}: GalleryDetailPanelProps): ReactElement => {
    const imageUrl = getImageUrl(media);

    return (
        <aside className="sb-detail" 
                aria-label="선택한 미디어 상세"
                onClick={(e) => e.stopPropagation()}
        >
            <header className="sb-detail-head">
                <strong className="text-sm">상세 정보</strong>
                <button className="sb-icon-button" type="button" title="더보기" aria-label="더보기">
                    <MoreHorizontal size={18} strokeWidth={1.8} />
                </button>
            </header>

            <div className="sb-detail-body">
                {media ? (
                    <>
                        <div className="sb-detail-preview">
                            {imageUrl ? (
                                <img src={imageUrl} alt={`${media.title} 미리보기`} />
                            ) : (
                                <div className="sb-thumb-empty" />
                            )}
                        </div>

                        <h2 className="sb-detail-title">{media.title}</h2>
                        <p className="sb-detail-url" title={media.url || media.filepath}>
                            {media.url || media.filepath || '저장 위치 없음'}
                        </p>

                        <div className="sb-info-list">
                            <div className="sb-info-row">
                                <span>플랫폼</span>
                                <strong>{media.platform || '미분류'}</strong>
                            </div>

                            <div className="sb-info-row">
                                <span>작성자</span>
                                {media.author ? (
                                    <button
                                        type="button"
                                        className="sb-info-link"
                                        onClick={() => onFilterAuthor(media.author!)}
                                        title={`${media.author} 항목만 보기`}
                                    >
                                        {media.author}
                                    </button>
                                ) : (
                                    <strong>unknown</strong>
                                )}
                            </div>

                            <div className="sb-info-row">
                                <span>파일 크기</span>
                                <strong>{formatBytes(media.filesize)}</strong>
                            </div>

                            <div className="sb-info-row">
                                <span>저장일</span>
                                <strong>{new Date(media.createdAt).toLocaleDateString('ko-KR')}</strong>
                            </div>
                        </div>

                        <div className="sb-section-label">Tags</div>
                        <div className="sb-tag-cloud">
                            <span className="sb-chip is-active">{media.platform || 'media'}</span>
                            {media.isFavorite && <span className="sb-chip">즐겨찾기</span>}
                            <span className="sb-chip">미분류</span>
                        </div>
                    </>
                ) : (
                    <div className="sb-empty-state h-full">
                        <p className="text-sm font-semibold text-[var(--text-main)]">
                            선택한 미디어가 없습니다
                        </p>
                        <p className="mt-1 text-xs">카드를 선택하면 상세 정보가 표시됩니다.</p>
                    </div>
                )}
            </div>

            <div className="sb-detail-actions">
                <button
                    className="sb-action-button is-primary"
                    type="button"
                    disabled={!media?.filepath}
                    onClick={() =>
                        media?.filepath &&
                        window.electron?.ipcRenderer?.invoke('shell:show-item', media.filepath)
                    }
                >
                    <ExternalLink size={16} strokeWidth={1.8} />
                    열기
                </button>

                <button
                    className="sb-action-button"
                    type="button"
                    disabled={!media}
                    onClick={() => media && onOpenTagModal([media.id])}
                >
                    <Tags size={16} strokeWidth={1.8} />
                    태그
                </button>

                <button
                    className="sb-action-button"
                    type="button"
                    disabled={!media}
                    onClick={() => media && onDelete(media.id)}
                >
                    <Trash2 size={16} strokeWidth={1.8} />
                    삭제
                </button>
            </div>
        </aside>
    )
}