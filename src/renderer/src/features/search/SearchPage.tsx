import { useState } from "react";
import { useSearchViewModel } from "./useSearchViewModel";

export const SearchPage = () => {
    const vm = useSearchViewModel();
    const [tagInput, setTagInput] = useState('');
    const [platformInput, setPlatformInput] = useState('');
    const [authorInput, setAuthorInput] = useState('');

    // 태그 입력 핸들러
    const handleTagInput = (value: string) => {
        setTagInput(value);
        vm.suggestTags(value);
    };

    const handleTagKeyDown = (e: React.KeyboardEvent) => {
        if(e.key === 'Enter' && tagInput.trim()) {
            vm.addTag(tagInput.trim());
            setTagInput('');
        }
    };

    // 플랫폼 입력 핸들러
    const handlePlatformInput = (value: string) => {
        setPlatformInput(value);
        vm.suggestPlatforms(value);
    };

    const handlePlatformKeyDown = (e: React.KeyboardEvent) => {
        if(e.key === 'Enter' && platformInput.trim()) {
            vm.addPlatform(platformInput.trim());
            setPlatformInput('');
        }
    };

    // 작성자 입력 핸들러
    const handleAuthorInput = (value: string) => {
        setAuthorInput(value);
        vm.suggestAuthors(value);
    };

    const handleAuthorKeyDown = (e: React.KeyboardEvent) => {
        if(e.key === 'Enter' && authorInput.trim()) {
            vm.addAuthor(authorInput.trim());
            setAuthorInput('');
        }
    };

        return (
        <div className="flex flex-col h-full">
            {/* 검색 영역 */}
            <div className="p-4 border-b border-[--border-line] space-y-3">
                {/* 키워드 검색 */}
                <input
                    type="text"
                    value={vm.keyword}
                    onChange={(e) => vm.setKeyword(e.target.value)}
                    placeholder="제목, 작성자, URL, 태그로 검색..."
                    className="w-full px-4 py-2 rounded-lg
                        bg-[--bg-hover] text-[--text-main]
                        placeholder-[--text-placeholder]
                        border border-[--border-line]
                        focus:outline-none focus:border-[--color-primary]"
                />

                {/* 필터 입력 영역 */}
                <div className="flex gap-3">
                    {/* 태그 필터 */}
                    <div className="flex-1 relative">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={tagInput}
                                onChange={(e) => handleTagInput(e.target.value)}
                                onKeyDown={handleTagKeyDown}
                                placeholder="태그 추가..."
                                className="flex-1 px-3 py-1.5 text-sm rounded-lg
                                    bg-[--bg-hover] text-[--text-main]
                                    placeholder-[--text-placeholder]
                                    border border-[--border-line]
                                    focus:outline-none focus:border-[--color-primary]"
                            />
                            {/* AND/OR 토글 */}
                            {vm.selectedTags.length > 1 && (
                                <button
                                    onClick={() => vm.setTagMode(vm.tagMode === 'and' ? 'or' : 'and')}
                                    className={`px-2 py-1.5 text-xs font-bold rounded-lg border transition-colors
                                        ${vm.tagMode === 'and'
                                            ? 'bg-[--color-primary] text-white border-[--color-primary]'
                                            : 'bg-[--bg-hover] text-[--text-main] border-[--border-line]'
                                        }`}
                                >
                                    {vm.tagMode.toUpperCase()}
                                </button>
                            )}
                        </div>
                        {/* 태그 자동완성 */}
                        {vm.tagSuggestions.length > 0 && (
                            <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-[--border-line] bg-(--bg-popup) shadow-lg overflow-hidden">
                                {vm.tagSuggestions.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => { vm.addTag(tag); setTagInput(''); }}
                                        className="w-full px-3 py-2 text-sm text-left text-[--text-main] hover:bg-[--bg-hover]"
                                    >{tag}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 플랫폼 필터 */}
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={platformInput}
                            onChange={(e) => handlePlatformInput(e.target.value)}
                            onKeyDown={handlePlatformKeyDown}
                            placeholder="플랫폼 추가..."
                            className="w-full px-3 py-1.5 text-sm rounded-lg
                                bg-[--bg-hover] text-[--text-main]
                                placeholder-[--text-placeholder]
                                border border-[--border-line]
                                focus:outline-none focus:border-[--color-primary]"
                        />
                        {vm.platformSuggestions.length > 0 && (
                            <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-[--border-line] bg-(--bg-popup) shadow-lg overflow-hidden">
                                {vm.platformSuggestions.map(p => (
                                    <button
                                        key={p}
                                        onClick={() => { vm.addPlatform(p); setPlatformInput(''); }}
                                        className="w-full px-3 py-2 text-sm text-left text-[--text-main] hover:bg-[--bg-hover]"
                                    >{p}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 작성자 필터 */}
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={authorInput}
                            onChange={(e) => handleAuthorInput(e.target.value)}
                            onKeyDown={handleAuthorKeyDown}
                            placeholder="작성자 추가..."
                            className="w-full px-3 py-1.5 text-sm rounded-lg
                                bg-[--bg-hover] text-[--text-main]
                                placeholder-[--text-placeholder]
                                border border-[--border-line]
                                focus:outline-none focus:border-[--color-primary]"
                        />
                        {vm.authorSuggestions.length > 0 && (
                            <div className="absolute z-20 top-full mt-1 w-full rounded-lg border border-[--border-line] bg-(--bg-popup) shadow-lg overflow-hidden">
                                {vm.authorSuggestions.map(a => (
                                    <button
                                        key={a}
                                        onClick={() => { vm.addAuthor(a); setAuthorInput(''); }}
                                        className="w-full px-3 py-2 text-sm text-left text-[--text-main] hover:bg-[--bg-hover]"
                                    >{a}</button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 선택된 필터 칩 */}
                {(vm.selectedTags.length > 0 || vm.selectedPlatforms.length > 0 || vm.selectedAuthors.length > 0) && (
                    <div className="flex flex-wrap gap-2 items-center">
                        {vm.selectedTags.map(tag => (
                            <span key={`tag-${tag}`}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[--color-primary] text-white">
                                {tag}
                                <button onClick={() => vm.removeTag(tag)} className="hover:opacity-70">x</button>
                            </span>
                        ))}
                        {vm.selectedPlatforms.map(p => (
                            <span key={`platform-${p}`}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[--bg-active] text-[--text-main]">
                                {p}
                                <button onClick={() => vm.removePlatform(p)} className="hover:opacity-70">x</button>
                            </span>
                        ))}
                        {vm.selectedAuthors.map(a => (
                            <span key={`author-${a}`}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[--bg-active] text-[--text-main] border border-[--border-line]">
                                {a}
                                <button onClick={() => vm.removeAuthor(a)} className="hover:opacity-70">x</button>
                            </span>
                        ))}
                        <button
                            onClick={vm.clearAll}
                            className="text-xs text-[--text-muted] hover:text-[--text-main]"
                        >
                            초기화
                        </button>
                    </div>
                )}
            </div>

            {/* 결과 헤더 */}
            <div className="px-4 py-2 text-sm text-[--text-muted]">
                {vm.isLoading ? '검색 중...' : `${vm.total}개 결과`}
            </div>

            {/* 결과 그리드 */}
            <div className="flex-1 overflow-y-auto p-4">
                {vm.results.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {vm.results.map(media => (
                            <SearchResultCard key={media.id} media={media} />
                        ))}
                    </div>
                ) : !vm.isLoading ? (
                    <div className="flex items-center justify-center h-full text-[--text-muted]">
                        {vm.keyword || vm.selectedTags.length > 0 || vm.selectedPlatforms.length > 0 || vm.selectedAuthors.length > 0
                            ? '검색 결과가 없습니다'
                            : '검색어를 입력하세요'}
                    </div>
                ) : null}

                {vm.hasNextPage && (
                    <div className="flex justify-center mt-4">
                        <button
                            onClick={vm.loadMore}
                            className="px-4 py-2 text-sm rounded-lg
                                bg-[--bg-hover] text-[--text-main]
                                hover:bg-[--bg-active]"
                        >
                            더 보기
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// 검색 결과 카드
const SearchResultCard = ({ media }: { media: any }) => {
    const thumbnailUrl = media.thumbnailPath
        ? `media:///${media.thumbnailPath}`
        : null;

    return (
        <div className="group relative rounded-xl overflow-hidden border-2 transition-all duration-200 shadow-sm
            bg-[--bg-sidebar] hover:border-[--border-line] hover:scale-[1.02] hover:shadow-lg cursor-pointer"
        >
            {/* 썸네일 */}
            <div className="aspect-video bg-[--bg-active] overflow-hidden">
                {thumbnailUrl ? (
                    <img
                        src={thumbnailUrl}
                        alt={media.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-[--text-muted]">
                        <span className="text-[10px] opacity-60">No Preview</span>
                    </div>
                )}
            </div>

            {/* 정보 */}
            <div className="p-3 border-t border-[--border-line]">
                <h3 className="text-sm font-medium truncate text-[--text-main]" title={media.title}>
                    {media.title}
                </h3>
                <div className="flex gap-2 mt-1 text-xs text-[--text-muted]">
                    {media.author && <span>{media.author}</span>}
                    {media.platform && <span>· {media.platform}</span>}
                </div>
            </div>
        </div>
    );
}