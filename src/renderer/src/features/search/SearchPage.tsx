import { type KeyboardEvent, type ReactElement, useState } from 'react'
import { Search, X } from 'lucide-react'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
import { Button } from '@renderer/components/ui/Button'
import { ChipButton } from '@renderer/components/ui/Chip'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { TagModal } from '@renderer/components/TagModal'
import { PhotoCard } from '../gallery/PhotoCard'
import { useSearchViewModel } from './useSearchViewModel'

const SuggestionList = ({
    items,
    onSelect
}: {
    items: string[]
    onSelect: (value: string) => void
}): ReactElement | null => {
    if (items.length === 0) return null

    return (
        <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {items.map((item) => (
                <button
                    key={item}
                    type="button"
                    onClick={() => onSelect(item)}
                    className="w-full px-3 py-2 text-left text-sm text-slate-950 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                    {item}
                </button>
            ))}
        </div>
    )
}

export const SearchPage = (): ReactElement => {
    const vm = useSearchViewModel()
    const [tagInput, setTagInput] = useState('')
    const [platformInput, setPlatformInput] = useState('')
    const [authorInput, setAuthorInput] = useState('')

    const addTagFromInput = (): void => {
        const value = tagInput.trim()
        if (!value) return
        vm.addTag(value)
        setTagInput('')
    }

    const addPlatformFromInput = (): void => {
        const value = platformInput.trim()
        if (!value) return
        vm.addPlatform(value)
        setPlatformInput('')
    }

    const addAuthorFromInput = (): void => {
        const value = authorInput.trim()
        if (!value) return
        vm.addAuthor(value)
        setAuthorInput('')
    }

    const handleEnter = (e: KeyboardEvent, action: () => void): void => {
        if (e.key === 'Enter') action()
    }

    const hasFilters =
        vm.selectedTags.length > 0 ||
        vm.selectedPlatforms.length > 0 ||
        vm.selectedAuthors.length > 0

    return (
        <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] px-5 pb-5 pt-[18px]">
            <header>
                <h1 className="m-0 text-2xl font-bold leading-tight text-slate-950 dark:text-slate-100">
                    검색
                </h1>
                <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400">
                    {vm.isLoading ? '검색 중...' : `결과 ${vm.total}개`}
                </p>
            </header>

            <div className="mt-4 grid gap-3">
                <div className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 focus-within:border-slate-300 focus-within:ring-4 focus-within:ring-indigo-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:focus-within:border-slate-600 dark:focus-within:ring-indigo-950">
                    <Search size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                    <input
                        type="text"
                        value={vm.keyword}
                        onChange={(e) => vm.setKeyword(e.target.value)}
                        placeholder="제목, 작성자, URL, 태그 검색"
                        aria-label="미디어 검색"
                        className="min-w-0 flex-1 bg-transparent text-slate-950 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    <div className="relative">
                        <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => {
                                setTagInput(e.target.value)
                                vm.suggestTags(e.target.value)
                            }}
                            onKeyDown={(e) => handleEnter(e, addTagFromInput)}
                            placeholder="태그 추가"
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600"
                        />
                        <SuggestionList
                            items={vm.tagSuggestions}
                            onSelect={(tag) => {
                                vm.addTag(tag)
                                setTagInput('')
                            }}
                        />
                    </div>

                    <div className="relative">
                        <input
                            type="text"
                            value={platformInput}
                            onChange={(e) => {
                                setPlatformInput(e.target.value)
                                vm.suggestPlatforms(e.target.value)
                            }}
                            onKeyDown={(e) => handleEnter(e, addPlatformFromInput)}
                            placeholder="플랫폼 추가"
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600"
                        />
                        <SuggestionList
                            items={vm.platformSuggestions}
                            onSelect={(platform) => {
                                vm.addPlatform(platform)
                                setPlatformInput('')
                            }}
                        />
                    </div>

                    <div className="relative">
                        <input
                            type="text"
                            value={authorInput}
                            onChange={(e) => {
                                setAuthorInput(e.target.value)
                                vm.suggestAuthors(e.target.value)
                            }}
                            onKeyDown={(e) => handleEnter(e, addAuthorFromInput)}
                            placeholder="작성자 추가"
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-600"
                        />
                        <SuggestionList
                            items={vm.authorSuggestions}
                            onSelect={(author) => {
                                vm.addAuthor(author)
                                setAuthorInput('')
                            }}
                        />
                    </div>
                </div>

                {hasFilters && (
                    <div className="flex flex-wrap items-center gap-2">
                        {vm.selectedTags.map((tag) => (
                            <ChipButton key={`tag-${tag}`} onClick={() => vm.removeTag(tag)} active>
                                {tag}
                                <X size={13} />
                            </ChipButton>
                        ))}
                        {vm.selectedPlatforms.map((platform) => (
                            <ChipButton
                                key={`platform-${platform}`}
                                onClick={() => vm.removePlatform(platform)}
                            >
                                {platform}
                                <X size={13} />
                            </ChipButton>
                        ))}
                        {vm.selectedAuthors.map((author) => (
                            <ChipButton
                                key={`author-${author}`}
                                onClick={() => vm.removeAuthor(author)}
                            >
                                {author}
                                <X size={13} />
                            </ChipButton>
                        ))}
                        <button
                            type="button"
                            onClick={vm.clearAll}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
                        >
                            초기화
                        </button>
                    </div>
                )}
            </div>

            <div className="mt-4 min-h-0 overflow-auto pr-1">
                {vm.results.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
                        {vm.results.map((media) => (
                            <PhotoCard
                                key={media.id}
                                data={media}
                                isSelected={
                                    vm.selectedId === media.id || vm.selectedIds.has(media.id)
                                }
                                onClick={vm.handleSelect}
                                onContextMenu={vm.handleContextMenu}
                                onToggleFavorite={vm.toggleFavorite}
                                onDelete={vm.deleteMedia}
                            />
                        ))}
                    </div>
                ) : (
                    !vm.isLoading && (
                        <EmptyState
                            icon={<Search size={28} strokeWidth={1.7} />}
                            title="검색 결과가 없습니다"
                            description="검색어 또는 필터를 조정해보세요."
                        />
                    )
                )}

                {vm.hasNextPage && (
                    <div className="mt-4 flex justify-center">
                        <Button type="button" onClick={vm.loadMore} variant="secondary" size="md">
                            더 보기
                        </Button>
                    </div>
                )}
            </div>

            {vm.contextMenu && (
                <ContextMenu
                    x={vm.contextMenu.x}
                    y={vm.contextMenu.y}
                    onClose={vm.closeContextMenu}
                    items={[
                        {
                            label: '태그 관리',
                            onClick: () => {
                                const ids =
                                    vm.selectedIds.size > 0
                                        ? [...vm.selectedIds]
                                        : [vm.contextMenu!.mediaId]
                                vm.openTagModal(ids)
                            }
                        },
                        {
                            label: '삭제',
                            danger: true,
                            onClick: () => vm.deleteMedia(vm.contextMenu!.mediaId)
                        }
                    ]}
                />
            )}

            {vm.tagModal && (
                <TagModal
                    mediaIds={vm.tagModal.mediaIds}
                    onClose={vm.closeTagModal}
                    onUpdated={vm.refresh}
                />
            )}
        </section>
    )
}
