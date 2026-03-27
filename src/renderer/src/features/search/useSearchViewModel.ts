import { useState, useCallback, useEffect, useRef } from "react";
import { Media, MediaSearchRequest, MediaSearchResult } from '../../../../shared/types';


export const useSearchViewModel = () => {
    const [keyword, setKeyword] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagMode, setTagMode] = useState<'and' | 'or'>('and');
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
    const [selectedAuthors, setSelectedAuthors] = useState<string[]>([]);

    const [results, setResults] = useState<Media[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
    const [platformSuggestions, setPlatformSuggestions] = useState<string[]>([]);
    const [authorSuggestions, setAuthorSuggestions] = useState<string[]>([]);

    const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

    const search = useCallback(async (pageNum = 1) => {
        setIsLoading(true);
        try {
            const request: MediaSearchRequest = {
                page: pageNum,
                limit: 50,
                keyword: keyword || undefined,
                tags: selectedTags.length > 0 ? selectedTags : undefined,
                tagMode,
                platform: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
                author: selectedAuthors.length > 0 ? selectedAuthors : undefined,
            };
            const result: MediaSearchResult = await window.api.searchMedia(request);

            if (pageNum === 1) {
                setResults(result.data);
            } else {
                setResults(prev => [...prev, ...result.data]);
            }
            setTotal(result.total);
            setPage(pageNum);
            setHasNextPage(result.hasNextPage ?? false);
        } catch(error) {
            console.error('[Search] Failed:', error);
        } finally {
            setIsLoading(false);
        }
    }, [keyword, selectedTags, tagMode, selectedPlatforms, selectedAuthors]);

    // 필터 변경 시 디바운스 검색
    useEffect(() => {
        if(debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => search(1), 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [keyword, selectedTags, tagMode, selectedPlatforms, selectedAuthors]);

    // 자동 완성
    const suggestTags = useCallback(async (input: string) => {
        if(!input) { setTagSuggestions([]); return }
        const suggestions = await window.api.suggestTags(input);
        setTagSuggestions(suggestions.filter(s => !selectedTags.includes(s)));
    }, [selectedTags]);

    const suggestPlatforms = useCallback(async (input: string) => {
        if(!input) { setPlatformSuggestions([]); return; }
        const suggestions = await window.api.suggestPlatforms(input);
        setPlatformSuggestions(suggestions.filter(s => !selectedPlatforms.includes(s)));
    }, [selectedPlatforms]);

    const suggestAuthors = useCallback(async (input: string) => {
        if(!input) { setAuthorSuggestions([]); return; }
        const suggestions = await window.api.suggestAuthors(input);
        setAuthorSuggestions(suggestions.filter(s => !selectedAuthors.includes(s)));
    }, [selectedAuthors]);

    // 필터 추가/제거
    const addTag = useCallback((tag: string) => {
        setSelectedTags(prev => prev.includes(tag) ? prev : [...prev, tag]);
        setTagSuggestions([]);
    }, []);

    const removeTag = useCallback((tag: string) => {
        setSelectedTags(prev => prev.filter(t => t !== tag));
    }, []);

    const addPlatform = useCallback((platform: string) => {
        setSelectedPlatforms(prev => prev.includes(platform) ? prev : [...prev, platform]);
        setPlatformSuggestions([]);
    }, []);

    const removePlatform = useCallback((platform: string) => {
        setSelectedPlatforms(prev => prev.filter(p => p !== platform));
    }, []);
    
    const addAuthor = useCallback((author: string) => {
        setSelectedAuthors(prev => prev.includes(author) ? prev : [...prev, author]);
        setAuthorSuggestions([]);
    }, []);

    const removeAuthor = useCallback((author: string) => {
        setSelectedAuthors(prev => prev.filter(a => a !== author));
    }, []);

    // 다음 페이지
    const loadMore = useCallback(() => {
        if(hasNextPage && !isLoading) search(page + 1);
    }, [hasNextPage, isLoading, page, search]);

    // 전체 초기화
    const clearAll = useCallback(() => {
        setKeyword('');
        setSelectedTags([]);
        setTagMode('and');
        setSelectedPlatforms([]);
        setSelectedAuthors([]);
    }, []);

    return {
        keyword, setKeyword,
        selectedTags, addTag, removeTag,
        tagMode, setTagMode,
        selectedPlatforms, addPlatform, removePlatform,
        selectedAuthors, addAuthor, removeAuthor,
        results, total, isLoading, hasNextPage, loadMore,
        tagSuggestions, suggestTags,
        platformSuggestions, suggestPlatforms,
        authorSuggestions, suggestAuthors,
        clearAll,
    };
};