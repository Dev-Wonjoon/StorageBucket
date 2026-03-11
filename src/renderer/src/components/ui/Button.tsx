import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'ghost';
    size?: 'sm' | 'md';
}

export const Button = ({
    variant = 'primary',
    size = 'sm',
    className = '',
    disabled,
    children,
    ...props
}: ButtonProps) => {
    const base = 'rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
        primary: 'bg-[--color-primary] text-white border hover:bg-[--color-primary-hover]',
        ghost: 'bg-transparent text-[--text-muted] border hover:bg-[--bg-hover] hover:text-[--text-main]',
    };


    const sizes = {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2 text-sm',
    };

    return (
        <button
            className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
            style={{
                borderColor: 'var(--btn-border)',
                ...(variant === 'primary' && {
                    backgroundColor: 'var(--color-primary)',
                }),
            }}
            disabled={disabled}
            {...props}
        >
            {children}
        </button>
    )
}