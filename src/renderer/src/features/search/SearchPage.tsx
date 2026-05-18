import { type KeyboardEvent, type ReactElement, useState } from 'react'
import { Search, X } from 'lucide-react'
import { ContextMenu } from '@renderer/components/ui/ContextMenu'
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
        <div className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border-line)] bg-[var(--bg-popup)] shadow-lg">
            {items.map((item) => (
                <button
                    key={item}
                    type="button"
                    onClick={() => onSelect(item)}
                    className="w-full px-3 py-2 text-left text-sm text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
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
        <section className="sb-library">
            <header>
                <h1 className="sb-page-title">검색</h1>
                <p className="sb-page-subtitle">
                    {vm.isLoading ? '검색 중...' : `결과 ${vm.total}개`}
                </p>
            </header>

            <div className="mt-4 grid gap-3">
                <div className="sb-input-shell">
                    <Search size={18} strokeWidth={1.8} className="ml-3 flex-none" />
                    <input
                        type="text"
                        value={vm.keyword}
                        onChange={(e) => vm.setKeyword(e.target.value)}
                        placeholder="제목, 작성자, URL, 태그 검색"
                        aria-label="미디어 검색"
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
                            className="h-10 w-full rounded-lg border border-[var(--border-line)] bg-[var(--bg-popup)] px-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--border-strong)]"
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
                            className="h-10 w-full rounded-lg border border-[var(--border-line)] bg-[var(--bg-popup)] px-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--border-strong)]"
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
                            className="h-10 w-full rounded-lg border border-[var(--border-line)] bg-[var(--bg-popup)] px-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--border-strong)]"
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
                            <button
                                key={`tag-${tag}`}
                                type="button"
                                onClick={() => vm.removeTag(tag)}
                                className="sb-chip is-active gap-1"
                            >
                                {tag}
                                <X size={13} />
                            </button>
                        ))}
                        {vm.selectedPlatforms.map((platform) => (
                            <button
                                key={`platform-${platform}`}
                                type="button"
                                onClick={() => vm.removePlatform(platform)}
                                className="sb-chip gap-1"
                            >
                                {platform}
                                <X size={13} />
                            </button>
                        ))}
                        {vm.selectedAuthors.map((author) => (
                            <button
                                key={`author-${author}`}
                                type="button"
                                onClick={() => vm.removeAuthor(author)}
                                className="sb-chip gap-1"
                            >
                                {author}
                                <X size={13} />
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={vm.clearAll}
                            className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                        >
                            초기화
                        </button>
                    </div>
                )}
            </div>

            <div className="sb-gallery-scroll mt-4">
                {vm.results.length > 0 ? (
                    <div className="sb-media-grid">
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
                        <div className="sb-empty-state">
                            <Search size={28} strokeWidth={1.7} />
                            <p className="mt-3 text-lg font-semibold text-[var(--text-main)]">
                                검색 결과가 없습니다
                            </p>
                            <p className="mt-1 text-sm">검색어 또는 필터를 조정해보세요.</p>
                        </div>
                    )
                )}

                {vm.hasNextPage && (
                    <div className="mt-4 flex justify-center">
                        <button
                            type="button"
                            onClick={vm.loadMore}
                            className="sb-action-button px-4"
                        >
                            더 보기
                        </button>
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
