import { useCallback, useEffect, useRef, useState } from 'react'

export function useSuggestions(
    fetch: (input: string) => Promise<string[]>,
    selected: string[]
): { suggestions: string[]; suggest(input: string): Promise<void>; clear(): void } {
    const [suggestions, setSuggestions] = useState<string[]>([])
    const requestId = useRef(0)
    const clear = useCallback((): void => {
        requestId.current++
        setSuggestions([])
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
            if (!input.trim()) {
                setSuggestions([])
                return
            }
            try {
                const values = await fetch(input)
                if (current === requestId.current)
                    setSuggestions(values.filter((value) => !selected.includes(value)))
            } catch (error) {
                if (current !== requestId.current) return
                console.error('[Suggestions] Failed:', error)
                setSuggestions([])
            }
        },
        [fetch, selected]
    )
    return { suggestions, suggest, clear }
}
