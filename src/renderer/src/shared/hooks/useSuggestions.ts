import { useCallback, useEffect, useRef, useState } from 'react'

export function useSuggestions(
    fetch: (input: string) => Promise<string[]>,
    selected: string[]
): {
    suggestions: string[]
    error: string | null
    suggest(input: string): Promise<void>
    clear(): void
} {
    const [suggestions, setSuggestions] = useState<string[]>([])

    const [error, setError] = useState<string | null>(null)

    const requestId = useRef(0)

    const clear = useCallback((): void => {
        requestId.current++
        setSuggestions([])
        setError(null)
    }, [])

    useEffect(
        () => () => {
            requestId.current++
        },
        [selected]
    )

    const suggest = useCallback(
        async (input: string): Promise<void> => {
            const current = ++requestId.current

            setError(null)

            if (!input.trim()) {
                setSuggestions([])
                return
            }

            try {
                const values = await fetch(input)

                if (current !== requestId.current) {
                    return
                }

                setSuggestions(values.filter((value) => !selected.includes(value)))
            } catch {
                if (current !== requestId.current) {
                    return
                }

                setSuggestions([])

                setError('자동완성을 불러오지 못했습니다. 다시 입력해 주세요.')
            }
        },
        [fetch, selected]
    )

    return {
        suggestions,
        error,
        suggest,
        clear
    }
}
