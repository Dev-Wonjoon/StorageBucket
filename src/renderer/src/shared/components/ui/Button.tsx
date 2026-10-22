import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'ghost'
    size?: 'sm' | 'md'
}
export function Button({
    variant = 'primary',
    size = 'sm',
    type = 'button',
    className = '',
    children,
    ...props
}: ButtonProps): React.JSX.Element {
    const variants = {
        primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]',
        ghost: 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
    }
    const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
    return (
        <button
            type={type}
            className={`rounded-lg border border-[var(--btn-border)] font-medium transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
            {...props}
        >
            {children}
        </button>
    )
}
