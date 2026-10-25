import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { MediaFilter } from '../../../../shared/media-v2'
import { getApi } from '@renderer/shared/api'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'
import { createGalleryStore } from './galleryStore'

export function useGalleryViewModel(
    favoritesOnly = false,
    filter?: MediaFilter,
    showDownloads = true
) {
    const store = useMemo(
        () => createGalleryStore(getApi().media, { favoritesOnly }),
        [favoritesOnly]
    )

    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    const { queue, mediaRevision } = useDownloadViewModel()

    const filterKey = JSON.stringify(filter ?? {})

    useEffect(() => () => store.cancelReads(), [store])

    useEffect(() => {
        store.setFilter(JSON.parse(filterKey) as MediaFilter)

        void store.refresh()
    }, [store, mediaRevision, filterKey])

    return {
        store,
        snapshot,
        activeDownloads:
            favoritesOnly || !showDownloads
                ? []
                : queue.filter((job) => job.state === 'pending' || job.state === 'running')
    }
}
