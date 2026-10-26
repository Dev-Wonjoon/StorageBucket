import { GalleryPage } from '@renderer/features/gallery/GalleryPage'
import { useState } from 'react'
import { useSearchViewModel } from '@renderer/features/search/useSearchViewModel'

export const SearchPage = (): React.JSX.Element => {
    const vm = useSearchViewModel()
    const [tagInput, setTagInput] = useState('')
    const [platformInput, setPlatformInput] = useState('')
    const [authorInput, setAuthorInput] = useState('')

    // 태그 입력 핸들러
    const handleTagInput = (value: string): void => {
        setTagInput(value)
        vm.suggestTags(value)
    }

    const handleTagKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' && tagInput.trim()) {
            vm.addTag(tagInput.trim())
            setTagInput('')
        }
    }

    // 플랫폼 입력 핸들러
    const handlePlatformInput = (value: string): void => {
        setPlatformInput(value)
        vm.suggestPlatforms(value)
    }

    const handlePlatformKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' && platformInput.trim()) {
            vm.addPlatform(platformInput.trim())
            setPlatformInput('')
        }
    }

    // 작성자 입력 핸들러
    const handleAuthorInput = (value: string): void => {
        setAuthorInput(value)
        vm.suggestAuthors(value)
    }

    const handleAuthorKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Enter' && authorInput.trim()) {
            vm.addAuthor(authorInput.trim())
            setAuthorInput('')
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* 검색 영역 */}
            <div className="p-4 border-b border-[var(--border-line)] space-y-3">
                {/* 키워드 검색 */}
                <input
                    type="text"
                    maxLength={1000}
                    value={vm.keyword}
                    onChange={(e) => vm.setKeyword(e.target.value)}
                    placeholder="제목, 작성자, URL, 태그로 검색..."
                    className="w-full px-4 py-2 rounded-lg
                        bg-[var(--bg-hover)] text-[var(--text-main)]
                        placeholder-[var(--text-placeholder)]
                        border border-[var(--border-line)]
                        focus:outline-none focus:border-[var(--color-primary)]"
                />

                {/* 필터 입력 영역 */}
                <div className="flex gap-3">
                    {/* 태그 필터 */}
                    <div className="flex-1 relative">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={tagInput}
                                maxLength={200}
                                onChange={(e) => handleTagInput(e.target.value)}
                                onKeyDown={handleTagKeyDown}
                                placeholder="태그 추가..."
                                className="flex-1 px-3 py-1.5 text-sm rounded-lg
                                    bg-[var(--bg-hover)] text-[var(--text-main)]
                                    placeholder-[var(--text-placeholder)]
                                    border border-[var(--border-line)]
                                    focus:outline-none focus:border-[var(--color-primary)]"
                            />
                            {/* AND/OR 토글 */}
                            {vm.selectedTags.length > 1 && (
                                <button
                                    onClick={() =>
                                        vm.setTagMode(vm.tagMode === 'and' ? 'or' : 'and')
                                    }
                                    className={`px-2 py-1.5 text-xs font-bold rounded-lg border transition-colors
                                        ${
                                            vm.tagMode === 'and'
                                                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                                                : 'bg-[var(--bg-hover)] text-[var(--text-main)] border-[var(--border-line)]'
                                        }`}
                                >
                                    {vm.tagMode.toUpperCase()}
                                </button>
                            )}
                        </div>
                        {/* 태그 자동완성 */}
                        {vm.tagSuggestions.length > 0 && (
                            <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-[var(--border-line)] bg-(--bg-popup) shadow-lg overflow-hidden">
                                {vm.tagSuggestions.map((tag) => (
                                    <button
                                        key={tag}
                                        onClick={() => {
                                            vm.addTag(tag)
                                            setTagInput('')
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 플랫폼 필터 */}
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            maxLength={200}
                            value={platformInput}
                            onChange={(e) => handlePlatformInput(e.target.value)}
                            onKeyDown={handlePlatformKeyDown}
                            placeholder="플랫폼 추가..."
                            className="w-full px-3 py-1.5 text-sm rounded-lg
                                bg-[var(--bg-hover)] text-[var(--text-main)]
                                placeholder-[var(--text-placeholder)]
                                border border-[var(--border-line)]
                                focus:outline-none focus:border-[var(--color-primary)]"
                        />
                        {vm.platformSuggestions.length > 0 && (
                            <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-[var(--border-line)] bg-(--bg-popup) shadow-lg overflow-hidden">
                                {vm.platformSuggestions.map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => {
                                            vm.addPlatform(p)
                                            setPlatformInput('')
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 작성자 필터 */}
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            maxLength={200}
                            value={authorInput}
                            onChange={(e) => handleAuthorInput(e.target.value)}
                            onKeyDown={handleAuthorKeyDown}
                            placeholder="작성자 추가..."
                            className="w-full px-3 py-1.5 text-sm rounded-lg
                                bg-[var(--bg-hover)] text-[var(--text-main)]
                                placeholder-[var(--text-placeholder)]
                                border border-[var(--border-line)]
                                focus:outline-none focus:border-[var(--color-primary)]"
                        />
                        {vm.authorSuggestions.length > 0 && (
                            <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-[var(--border-line)] bg-(--bg-popup) shadow-lg overflow-hidden">
                                {vm.authorSuggestions.map((a) => (
                                    <button
                                        key={a}
                                        onClick={() => {
                                            vm.addAuthor(a)
                                            setAuthorInput('')
                                        }}
                                        className="w-full px-3 py-2 text-sm text-left text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                                    >
                                        {a}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 선택된 필터 칩 */}
                {(vm.selectedTags.length > 0 ||
                    vm.selectedPlatforms.length > 0 ||
                    vm.selectedAuthors.length > 0) && (
                    <div className="flex flex-wrap gap-2 items-center">
                        {vm.selectedTags.map((tag) => (
                            <span
                                key={`tag-${tag}`}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[var(--color-primary)] text-white"
                            >
                                {tag}
                                <button
                                    onClick={() => vm.removeTag(tag)}
                                    className="hover:opacity-70"
                                >
                                    x
                                </button>
                            </span>
                        ))}
                        {vm.selectedPlatforms.map((p) => (
                            <span
                                key={`platform-${p}`}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[var(--bg-active)] text-[var(--text-main)]"
                            >
                                {p}
                                <button
                                    onClick={() => vm.removePlatform(p)}
                                    className="hover:opacity-70"
                                >
                                    x
                                </button>
                            </span>
                        ))}
                        {vm.selectedAuthors.map((a) => (
                            <span
                                key={`author-${a}`}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[var(--bg-active)] text-[var(--text-main)] border border-[var(--border-line)]"
                            >
                                {a}
                                <button
                                    onClick={() => vm.removeAuthor(a)}
                                    className="hover:opacity-70"
                                >
                                    x
                                </button>
                            </span>
                        ))}
                        <button
                            onClick={vm.clearAll}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
                        >
                            초기화
                        </button>
                    </div>
                )}
            </div>

            {/* 결과 헤더 */}
            {vm.suggestionError && (
                <p role="status" className="px-4 py-2 text-sm text-[var(--text-muted)]">
                    {vm.suggestionError}
                </p>
            )}

            <div className="flex-1 min-h-0 overflow-hidden">
                <GalleryPage
                    title="검색 결과"
                    filter={vm.filter}
                    emptyMessage="검색 결과가 없습니다."
                />
            </div>
        </div>
    )
}
