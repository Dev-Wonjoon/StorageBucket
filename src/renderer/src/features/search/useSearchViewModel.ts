import {
    type Dispatch,
    type MouseEvent,
    type SetStateAction,
    useCallback,
    useEffect,
    useRef,
    useState
} from 'react'
import { useMediaActions } from '@renderer/hooks/useMediaActions'
import { Media, MediaSearchRequest, MediaSearchResult } from 'src/shared/types'

interface SearchViewModel {
    keyword: string
    setKeyword: Dispatch<SetStateAction<string>>
    selectedTags: string[]
    addTag: (tag: string) => void
    removeTag: (tag: string) => void
    tagMode: 'and' | 'or'
    setTagMode: Dispatch<SetStateAction<'and' | 'or'>>
    selectedPlatforms: string[]
    addPlatform: (platform: string) => void
    removePlatform: (platform: string) => void
    selectedAuthors: string[]
    addAuthor: (author: string) => void
    removeAuthor: (author: string) => void
    results: Media[]
    total: number
    isLoading: boolean
    hasNextPage: boolean
    loadMore: () => void
    tagSuggestions: string[]
    suggestTags: (input: string) => Promise<void>
    platformSuggestions: string[]
    suggestPlatforms: (input: string) => Promise<void>
    authorSuggestions: string[]
    suggestAuthors: (input: string) => Promise<void>
    clearAll: () => void
    selectedId: number | null
    selectedIds: Set<number>
    selectAll: () => void
    clearSelection: () => void
    handleSelect: (id: number, e: MouseEvent) => void
    toggleFavorite: (id: number) => Promise<void>
    deleteMedia: (id: number) => Promise<void>
    contextMenu: { x: number; y: number; mediaId: number } | null
    handleContextMenu: (e: MouseEvent, mediaId: number) => void
    closeContextMenu: () => void
    tagModal: { mediaIds: number[] } | null
    openTagModal: (mediaIds: number[]) => void
    closeTagModal: () => void
    refresh: () => Promise<void>
}

export const useSearchViewModel = (): SearchViewModel => {
    const [keyword, setKeyword] = useState('')
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [tagMode, setTagMode] = useState<'and' | 'or'>('and')
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
    const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])

    const [results, setResults] = useState<Media[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [hasNextPage, setHasNextPage] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const actions = useMediaActions(setResults, results)

    const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
    const [platformSuggestions, setPlatformSuggestions] = useState<string[]>([])
    const [authorSuggestions, setAuthorSuggestions] = useState<string[]>([])
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const search = useCallback(
        async (pageNum = 1): Promise<void> => {
            setIsLoading(true)
            try {
                if (!window.api?.searchMedia) {
                    setResults([])
                    setTotal(0)
                    setHasNextPage(false)
                    return
                }

                const request: MediaSearchRequest = {
                    page: pageNum,
                    limit: 50,
                    keyword: keyword || undefined,
                    tags: selectedTags.length > 0 ? selectedTags : undefined,
                    tagMode,
                    platform: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
                    author: selectedAuthors.length > 0 ? selectedAuthors : undefined
                }
                const result: MediaSearchResult = await window.api.searchMedia(request)

                if (pageNum === 1) {
                    setResults(result.data)
                } else {
                    setResults((prev) => [...prev, ...result.data])
                }

                setTotal(result.total)
                setPage(pageNum)
                setHasNextPage(result.hasNextPage ?? false)
            } catch (error) {
                console.error('[Search] Failed:', error)
            } finally {
                setIsLoading(false)
            }
        },
        [keyword, selectedTags, tagMode, selectedPlatforms, selectedAuthors]
    )

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => search(1), 300)
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
        }
    }, [search])

    const suggestTags = useCallback(
        async (input: string): Promise<void> => {
            if (!input || !window.api?.suggestTags) {
                setTagSuggestions([])
                return
            }
            const suggestions = await window.api.suggestTags(input)
            setTagSuggestions(suggestions.filter((s) => !selectedTags.includes(s)))
        },
        [selectedTags]
    )

    const suggestPlatforms = useCallback(
        async (input: string): Promise<void> => {
            if (!input || !window.api?.suggestPlatforms) {
                setPlatformSuggestions([])
                return
            }
            const suggestions = await window.api.suggestPlatforms(input)
            setPlatformSuggestions(suggestions.filter((s) => !selectedPlatforms.includes(s)))
        },
        [selectedPlatforms]
    )

    const suggestAuthors = useCallback(
        async (input: string): Promise<void> => {
            if (!input || !window.api?.suggestAuthors) {
                setAuthorSuggestions([])
                return
            }
            const suggestions = await window.api.suggestAuthors(input)
            setAuthorSuggestions(suggestions.filter((s) => !selectedAuthors.includes(s)))
        },
        [selectedAuthors]
    )

    const addTag = useCallback((tag: string): void => {
        setSelectedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]))
        setTagSuggestions([])
    }, [])

    const removeTag = useCallback((tag: string): void => {
        setSelectedTags((prev) => prev.filter((t) => t !== tag))
    }, [])

    const addPlatform = useCallback((platform: string): void => {
        setSelectedPlatforms((prev) => (prev.includes(platform) ? prev : [...prev, platform]))
        setPlatformSuggestions([])
    }, [])

    const removePlatform = useCallback((platform: string): void => {
        setSelectedPlatforms((prev) => prev.filter((p) => p !== platform))
    }, [])

    const addAuthor = useCallback((author: string): void => {
        setSelectedAuthors((prev) => (prev.includes(author) ? prev : [...prev, author]))
        setAuthorSuggestions([])
    }, [])

    const removeAuthor = useCallback((author: string): void => {
        setSelectedAuthors((prev) => prev.filter((a) => a !== author))
    }, [])

    const loadMore = useCallback((): void => {
        if (hasNextPage && !isLoading) search(page + 1)
    }, [hasNextPage, isLoading, page, search])

    const clearAll = useCallback((): void => {
        setKeyword('')
        setSelectedTags([])
        setTagMode('and')
        setSelectedPlatforms([])
        setSelectedAuthors([])
    }, [])

    return {
        keyword,
        setKeyword,
        selectedTags,
        addTag,
        removeTag,
        tagMode,
        setTagMode,
        selectedPlatforms,
        addPlatform,
        removePlatform,
        selectedAuthors,
        addAuthor,
        removeAuthor,
        results,
        total,
        isLoading,
        hasNextPage,
        loadMore,
        tagSuggestions,
        suggestTags,
        platformSuggestions,
        suggestPlatforms,
        authorSuggestions,
        suggestAuthors,
        clearAll,
        ...actions,
        refresh: () => search(1)
    }
}
