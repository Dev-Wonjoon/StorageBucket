import { useEffect, useMemo, useState } from 'react'
import type { MediaFilter, MediaSuggestionRequest } from '../../../../shared/media-v2'
import { getApi } from '@renderer/shared/api'
import { useSuggestions } from '@renderer/shared/hooks/useSuggestions'

async function suggest(kind: MediaSuggestionRequest['kind'], text: string): Promise<string[]> {
    const result = await getApi().media.suggest({
        kind,
        text
    })

    if (!result.ok) {
        throw new Error(result.error.message)
    }

    return result.data
}

const fetchTags = (text: string) => suggest('tag', text)

const fetchPlatforms = (text: string) => suggest('platform', text)

const fetchAuthors = (text: string) => suggest('author', text)

export function useSearchViewModel() {
    const [keyword, setKeyword] = useState('')

    const [debouncedKeyword, setDebouncedKeyword] = useState('')

    const [selectedTags, setSelectedTags] = useState<string[]>([])

    const [tagMode, setTagMode] = useState<'and' | 'or'>('and')

    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])

    const [selectedAuthors, setSelectedAuthors] = useState<string[]>([])

    const tags = useSuggestions(fetchTags, selectedTags)

    const platforms = useSuggestions(fetchPlatforms, selectedPlatforms)

    const authors = useSuggestions(fetchAuthors, selectedAuthors)

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300)

        return () => clearTimeout(timer)
    }, [keyword])

    const filter = useMemo<MediaFilter>(
        () => ({
            keyword: debouncedKeyword,
            tags: selectedTags,
            tagMode,
            platforms: selectedPlatforms,
            authors: selectedAuthors
        }),
        [debouncedKeyword, selectedTags, tagMode, selectedPlatforms, selectedAuthors]
    )

    const add = (
        value: string,
        update: React.Dispatch<React.SetStateAction<string[]>>,
        clear: () => void
    ) => {
        if (!value.trim()) return

        update((previous) => (previous.includes(value) ? previous : [...previous, value]))

        clear()
    }

    return {
        keyword,
        setKeyword,
        selectedTags,
        tagMode,
        setTagMode,
        selectedPlatforms,
        selectedAuthors,
        filter,

        suggestionError: tags.error ?? platforms.error ?? authors.error,

        clearAll() {
            setKeyword('')
            setDebouncedKeyword('')
            setSelectedTags([])
            setTagMode('and')
            setSelectedPlatforms([])
            setSelectedAuthors([])

            tags.clear()
            platforms.clear()
            authors.clear()
        },

        addTag: (value: string) => add(value, setSelectedTags, tags.clear),

        removeTag: (value: string) =>
            setSelectedTags((previous) => previous.filter((item) => item !== value)),

        addPlatform: (value: string) => add(value, setSelectedPlatforms, platforms.clear),

        removePlatform: (value: string) =>
            setSelectedPlatforms((previous) => previous.filter((item) => item !== value)),

        addAuthor: (value: string) => add(value, setSelectedAuthors, authors.clear),

        removeAuthor: (value: string) =>
            setSelectedAuthors((previous) => previous.filter((item) => item !== value)),

        tagSuggestions: tags.suggestions,
        suggestTags: tags.suggest,

        platformSuggestions: platforms.suggestions,
        suggestPlatforms: platforms.suggest,

        authorSuggestions: authors.suggestions,
        suggestAuthors: authors.suggest
    }
}
