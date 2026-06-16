
const INVALID_TEXT_VALUE = new Set([
    '',
    'none',
    'null',
    'undefined',
    'nan',
])

export const firstValidText = (...values: unknown[]): string | undefined => {
    for(const value of values) {
        if(value === null || value === undefined) continue

        const text = String(value).trim()
        if(!text) continue
        if(INVALID_TEXT_VALUE.has(text.toLowerCase())) continue

        return text
    }

    return undefined
}

export const safePathSegment = (value: unknown, fallback = 'unknown'): string => {
    const text = firstValidText(value) ?? fallback

    return text
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
}

export const safeFileStem = (value: unknown, fallback = 'unknown'): string => {
    const text = safePathSegment(value, fallback)

    return text.replace(/^\.+$/, fallback)
}
