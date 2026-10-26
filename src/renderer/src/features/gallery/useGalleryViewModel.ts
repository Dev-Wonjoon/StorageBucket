import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { MediaFilter } from '../../../../shared/media-v2'
import { getApi } from '@renderer/shared/api'
import { useToast } from '@renderer/shared/hooks/useToast'
import { useDownloadViewModel } from '@renderer/features/download/useDownloadViewModel'
import { createGalleryStore } from './galleryStore'

export function useGalleryViewModel(favoritesOnly = false, filter?: MediaFilter) {
    const { showToast } = useToast()

    const store = useMemo(
        () => createGalleryStore(getApi().media, { favoritesOnly }),
        [favoritesOnly]
    )

    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    const { mediaRevision } = useDownloadViewModel()
    const filterKey = JSON.stringify(filter ?? {})

    useEffect(() => () => store.cancelReads(), [store])

    useEffect(() => {
        store.setFilter(JSON.parse(filterKey) as MediaFilter)
        void store.refresh()
    }, [store, mediaRevision, filterKey])

    const openInFolder = useCallback(
        async (mediaId: number): Promise<void> => {
            try {
                const result = await getApi().media.get({
                    mediaId,
                    fileLimit: 1,
                    fileOffset: 0
                })

                if (!result.ok) {
                    showToast(result.error.message, 'error')
                    return
                }

                const filepath = result.data.files.data[0]?.filepath

                if (!filepath) {
                    showToast('등록된 파일 경로를 찾지 못했습니다.', 'error')
                    return
                }

                await getApi().showItemInFolder(filepath)
            } catch {
                showToast('파일 위치를 열지 못했습니다.', 'error')
            }
        },
        [showToast]
    )

    return {
        store,
        snapshot,
        openInFolder
    }
}
