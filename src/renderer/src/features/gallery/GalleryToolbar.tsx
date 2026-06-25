import { type ReactElement } from 'react'
import { ArrowDownAZ, Download, Filter, Grid3X3, List, Search } from 'lucide-react'
import { IconButton } from '@renderer/components/ui/IconButton'

export type GalleryViewMode = 'grid' | 'list' | 'queue'
export type GallerySortMode = 'recent' | 'titleAsc'

interface GalleryToolbarProps {
    query: string
    viewMode: GalleryViewMode
    sortMode: GallerySortMode
    onQueryChange: (query: string) => void
    onViewModeChange: (viewMode: GalleryViewMode) => void
    onSortModeChange: (sortMode: GallerySortMode) => void
}

export const GalleryToolbar = ({
    query,
    viewMode,
    sortMode,
    onQueryChange,
    onViewModeChange,
    onSortModeChange
}: GalleryToolbarProps): ReactElement => {
    const viewButtonClass = (active: boolean): string =>
        [
            'grid h-7 w-7 place-items-center rounded-md transition-colors',
            active
                ? 'bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950'
                : 'text-slate-500 hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'
        ].join(' ')

    return (
        <div className="my-3.5 grid grid-cols-[minmax(220px,1fr)_auto] gap-3 max-[840px]:grid-cols-1">
            <div className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 focus-within:border-slate-300 focus-within:ring-4 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:focus-within:border-slate-600 dark:focus-within:ring-indigo-950">
                <Search size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                <input
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="제목, 채널, 태그 검색"
                    aria-label="라이브러리 검색"
                    className="min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <div
                    className="mr-1 flex h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800"
                    role="group"
                    aria-label="보기 및 정렬"
                >
                    <button
                        type="button"
                        className={viewButtonClass(viewMode === 'grid')}
                        title="그리드 보기"
                        aria-label="그리드 보기"
                        onClick={() => onViewModeChange('grid')}
                    >
                        <Grid3X3 size={16} strokeWidth={1.8} />
                    </button>
                    <button
                        type="button"
                        className={viewButtonClass(viewMode === 'list')}
                        title="목록 보기"
                        aria-label="목록 보기"
                        onClick={() => onViewModeChange('list')}
                    >
                        <List size={16} strokeWidth={1.8} />
                    </button>
                    <button
                        type="button"
                        className={viewButtonClass(sortMode === 'titleAsc')}
                        title="이름순 정렬"
                        aria-label="이름순 정렬"
                        onClick={() =>
                            onSortModeChange(sortMode === 'titleAsc' ? 'recent' : 'titleAsc')
                        }
                    >
                        <ArrowDownAZ size={16} strokeWidth={1.8} />
                    </button>
                </div>
            </div>

            <div
                className="flex items-center justify-end gap-2 max-[840px]:justify-start"
                aria-label="라이브러리 도구"
            >
                <IconButton title="필터" aria-label="필터" disabled>
                    <Filter size={18} strokeWidth={1.8} />
                </IconButton>
                <IconButton
                    title={viewMode === 'queue' ? '전체 보기' : '다운로드 큐 보기'}
                    aria-label={viewMode === 'queue' ? '전체 보기' : '다운로드 큐 보기'}
                    active={viewMode === 'queue'}
                    onClick={() => onViewModeChange(viewMode === 'queue' ? 'grid' : 'queue')}
                >
                    <Download size={18} strokeWidth={1.8} />
                </IconButton>
            </div>
        </div>
    )
}
