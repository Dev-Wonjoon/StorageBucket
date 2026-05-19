import { type ReactElement } from "react";
import { ArrowDownAZ, Filter, Grid3X3, List, Search } from "lucide-react";

export type GalleryViewMode = 'grid' | 'list' | 'queue';

interface GalleryToolbarProps {
    query: string
    viewMode: GalleryViewMode
    onQueryChange: (query: string) => void
    onViewModeChange: (viewMode: GalleryViewMode) => void
}

export const GalleryToolbar = ({
    query,
    viewMode,
    onQueryChange,
    onViewModeChange
}: GalleryToolbarProps): ReactElement => {
    return (
        <div className="sb-filterbar">
            <div className="sb-input-shell">
                <Search size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                <input
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="제목, 채널, 태그 검색"
                    aria-label="라이브러리 검색"
                />
                <div className="sb-view-switch" role="tablist" aria-label="보기 방식">
                    <button
                        type="button"
                        className={`sb-view-button ${viewMode === 'grid' ? 'is-active' : ''}`}
                        title="그리드 보기"
                        aria-label="그리드 보기"
                        onClick={() => onViewModeChange('grid')}
                    >
                        <Grid3X3 size={16} strokeWidth={1.8} />
                    </button>
                    <button
                        type="button"
                        className={`sb-view-button ${viewMode === 'list' ? 'is-active' : ''}`}
                        title="목록 보기"
                        aria-label="목록 보기"
                        onClick={() => onViewModeChange('list')}
                    >
                        <List size={16} strokeWidth={1.8} />
                    </button>
                    <button
                        type="button"
                        className={`sb-view-button ${viewMode === 'queue' ? 'is-active' : ''}`}
                        title="진행 중 보기"
                        aria-label="진행 중 보기"
                        onClick={() => onViewModeChange('queue')}
                    >
                        <ArrowDownAZ size={16} strokeWidth={1.8} />
                    </button>
                </div>
            </div>

            <div className="sb-tool-group" aria-label="라이브러리 도구">
                <button className="sb-icon-button" type="button" title="필터" aria-label="필터">
                    <Filter size={18} strokeWidth={1.8} />
                </button>
                <button className="sb-icon-button" type="button" title="정렬" aria-label="정렬">
                    <ArrowDownAZ size={18} strokeWidth={1.8} />
                </button>
            </div>
        </div>
    )
}