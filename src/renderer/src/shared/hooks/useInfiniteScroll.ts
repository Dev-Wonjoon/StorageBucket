import { useEffect, type RefObject } from 'react'

interface InfiniteScrollOptions {
    rootRef: RefObject<HTMLElement | null>
    targetRef: RefObject<HTMLElement | null>
    enabled: boolean
    onLoadMore: () => Promise<unknown>
}

export function useInfiniteScroll({
    rootRef,
    targetRef,
    enabled,
    onLoadMore
}: InfiniteScrollOptions): void {
    useEffect(() => {
        const root = rootRef.current
        const target = targetRef.current

        if (!enabled || !root || !target) return

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    void onLoadMore()
                }
            },
            {
                root,
                rootMargin: '0px 0px 300px 0px',
                threshold: 0
            }
        )

        observer.observe(target)

        return () => observer.disconnect()
    }, [rootRef, targetRef, enabled, onLoadMore])
}
