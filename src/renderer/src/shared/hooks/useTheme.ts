import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

export function useTheme(): { theme: Theme; toggleTheme(): void } {
    const [theme, setTheme] = useState<Theme>(() => {
        const saved = localStorage.getItem('theme')
        if (saved === 'light' || saved === 'dark') return saved
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    })
    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark')
        localStorage.setItem('theme', theme)
    }, [theme])
    const toggleTheme = (): void =>
        setTheme((previous) => (previous === 'light' ? 'dark' : 'light'))
    return { theme, toggleTheme }
}
