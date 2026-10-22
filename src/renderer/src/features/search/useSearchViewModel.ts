import { useState, useCallback, useEffect, useRef } from 'react'
import type { Media, MediaSearchRequest } from '../../../../shared/types'
import { getApi } from '@renderer/shared/api'
import { useSuggestions } from '@renderer/shared/hooks/useSuggestions'

const fetchTags = (value: string): Promise<string[]> => getApi().suggestTags(value)
const fetchPlatforms = (value: string): Promise<string[]> => getApi().suggestPlatforms(value)
const fetchAuthors = (value: string): Promise<string[]> => getApi().suggestAuthors(value)

interface SearchViewModel {
    keyword: string
    setKeyword(value: string): void
    selectedTags: string[]
    tagMode: 'and' | 'or'
    setTagMode(value: 'and' | 'or'): void
    selectedPlatforms: string[]
    selectedAuthors: string[]
    results: Media[]
    total: number
    isLoading: boolean
    hasNextPage: boolean
    clearAll(): void
    addTag(value: string): void
    removeTag(value: string): void
    addPlatform(value: string): void
    removePlatform(value: string): void
    addAuthor(value: string): void
    removeAuthor(value: string): void
    tagSuggestions: string[]
    suggestTags(input: string): Promise<void>
    platformSuggestions: string[]
    suggestPlatforms(input: string): Promise<void>
    authorSuggestions: string[]
    suggestAuthors(input: string): Promise<void>
    loadMore(): void
}

export function useSearchViewModel(): SearchViewModel {
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
    const requestId = useRef(0)
    const loading = useRef(false)
    const tags = useSuggestions(fetchTags, selectedTags)
    const platforms = useSuggestions(fetchPlatforms, selectedPlatforms)
    const authors = useSuggestions(fetchAuthors, selectedAuthors)

    const search = useCallback(
        async (pageNum: number): Promise<void> => {
            const current = ++requestId.current
            loading.current = true
            setIsLoading(true)
            try {
                const request: MediaSearchRequest = {
                    page: pageNum,
                    limit: 50,
                    keyword: keyword || undefined,
                    tags: selectedTags.length ? selectedTags : undefined,
                    tagMode,
                    platform: selectedPlatforms.length ? selectedPlatforms : undefined,
                    author: selectedAuthors.length ? selectedAuthors : undefined
                }
                const result = await getApi().searchMedia(request)
                if (current !== requestId.current) return
                setResults((previous) =>
                    pageNum === 1 ? result.data : [...previous, ...result.data]
                )
                setTotal(result.total)
                setPage(pageNum)
                setHasNextPage(result.hasNextPage ?? false)
            } catch (error) {
                if (current !== requestId.current) return
                console.error('[Search] Failed:', error)
            } finally {
                if (current === requestId.current) {
                    loading.current = false
                    setIsLoading(false)
                }
            }
        },
        [keyword, selectedTags, tagMode, selectedPlatforms, selectedAuthors]
    )

    useEffect(() => {
        loading.current = true
        const requests = requestId
        const timer = setTimeout(() => {
            void search(1)
        }, 300)
        return () => {
            clearTimeout(timer)
            requests.current++
        }
    }, [search])

    const clearAll = (): void => {
        setKeyword('')
        setSelectedTags([])
        setTagMode('and')
        setSelectedPlatforms([])
        setSelectedAuthors([])
        tags.clear()
        platforms.clear()
        authors.clear()
    }

    return {
        keyword,
        setKeyword,
        selectedTags,
        tagMode,
        setTagMode,
        selectedPlatforms,
        selectedAuthors,
        results,
        total,
        isLoading,
        hasNextPage,
        clearAll,
        addTag: (value: string) => {
            setSelectedTags((previous) =>
                previous.includes(value) ? previous : [...previous, value]
            )
            tags.clear()
        },
        removeTag: (value: string) =>
            setSelectedTags((previous) => previous.filter((item) => item !== value)),
        addPlatform: (value: string) => {
            setSelectedPlatforms((previous) =>
                previous.includes(value) ? previous : [...previous, value]
            )
            platforms.clear()
        },
        removePlatform: (value: string) =>
            setSelectedPlatforms((previous) => previous.filter((item) => item !== value)),
        addAuthor: (value: string) => {
            setSelectedAuthors((previous) =>
                previous.includes(value) ? previous : [...previous, value]
            )
            authors.clear()
        },
        removeAuthor: (value: string) =>
            setSelectedAuthors((previous) => previous.filter((item) => item !== value)),
        tagSuggestions: tags.suggestions,
        suggestTags: tags.suggest,
        platformSuggestions: platforms.suggestions,
        suggestPlatforms: platforms.suggest,
        authorSuggestions: authors.suggestions,
        suggestAuthors: authors.suggest,
        loadMore: () => {
            if (hasNextPage && !loading.current) void search(page + 1)
        }
    }
}
