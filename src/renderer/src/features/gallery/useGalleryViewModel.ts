import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type DownloadJob, type GalleryItem, type Media } from 'src/shared/types'

const hashStringToNumber = (str: string): number =>
    Math.abs(str.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 0)) || Date.now()

const toDate = (value?: Date | string | null): Date => {
    if(!value) return new Date(0)

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? new Date(0) : date
}

const jobToPlaceholder = (item: DownloadJob): Media => ({
    id: -hashStringToNumber(item.id),
    title: item.title || item.url || item.id || '다운로드 실패',
    filepath: '',
    thumbnailPath: item.thumbnail || null,
    duration: 0,
    filesize: 0,
    platformId: null,
    profileId: null,
    createdAt: toDate(item.createdAt),
    updatedAt: toDate(item.updatedAt),
    author: '',
    platform: item.status === 'failed' ? 'Failed' : 'Queue',
    url: item.url || null
})

interface GalleryViewModel {
    galleryItems: GalleryItem[]
    medias: Media[]
    selectedId: number | null
    selectedIds: Set<number>
    contextMenu: { x: number; y: number; mediaId: number } | null
    tagModal: { mediaIds: number[] } | null
    isLoading: boolean
    toggleSelect: (id: number) => void
    toggleFavorite: (id: number) => Promise<void>
    deleteMedia: (id: number) => Promise<void>
    refresh: () => Promise<void>
    handleSelect: (id: number, e: React.MouseEvent) => void
    selectAll: () => void
    clearSelection: () => void
    handleContextMenu: (e: React.MouseEvent, mediaId: number) => void
    closeContextMenu: () => void
    openTagModal: (mediaIds: number[]) => void
    closeTagModal: () => void
}

export const useGalleryViewModel = (): GalleryViewModel => {
    const [medias, setMedias] = useState<Media[]>([])
    const [downloadQueue, setDownloadQueue] = useState<DownloadJob[]>([])
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [isLoading, setIsLoading] = useState(true)
    const lastClickedId = useRef<number | null>(null)

    const [contextMenu, setContextMenu] = useState<{
        x: number
        y: number
        mediaId: number
    } | null>(null)

    const [tagModal, setTagModal] = useState<{
        mediaIds: number[]
    } | null>(null)

    const galleryItems: GalleryItem[] = useMemo(() => {
        const jobsByUrl = new Map(downloadQueue.map((job) => [job.url, job]))

        const queueItems = downloadQueue
            .filter(
                (item) =>
                    item.status === 'downloading' ||
                    item.status === 'pending' ||
                    item.status === 'failed'
            )
            .map((item) => ({
                media: jobToPlaceholder(item),
                isDownloading: item.status === 'downloading' || item.status === 'pending',
                progress: item.progress,
                downloadId: item.id,
                downloadStatus: item.status,
                errorMessage: item.errorMessage ?? undefined,
                downloadLog: item.log
            }))

        const mediaItems = medias.map((media) => {
            const job = media.url ? jobsByUrl.get(media.url) : undefined
            const completedJob = job?.status === 'completed' ? job : undefined

            return {
                media,
                isDownloading: false,
                downloadId: completedJob?.id,
                errorMessage: completedJob?.errorMessage ?? undefined,
                downloadLog: completedJob?.log
            }
        })
        return [...queueItems, ...mediaItems].sort((a, b) => {
            const aTime = new Date(a.media.createdAt).getTime()
            const bTime = new Date(b.media.createdAt).getTime()

            return bTime - aTime
        })
    }, [downloadQueue, medias])

    const loadMedia = useCallback(async () => {
        try {
            setIsLoading(true)
            if (!window.api?.getMediaFiles) {
                setMedias([])
                return
            }
            const items = await window.api.getMediaFiles()
            setMedias(items)
        } catch (error) {
            console.error('[GalleryViewModel] Failed to load media', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const toggleSelect = useCallback((id: number) => {
        setSelectedId((prev) => (prev === id ? null : id))
    }, [])

    const handleSelect = useCallback(
        (id: number, e: React.MouseEvent) => {
            const target = galleryItems.find((item) => item.media.id === id)
            if (target?.downloadStatus) return

            if (e.ctrlKey || e.metaKey) {
                setSelectedIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                })
                setSelectedId(null)
            } else if (e.shiftKey && lastClickedId.current !== null) {
                const ids = galleryItems
                    .filter((item) => !item.downloadStatus)
                    .map((item) => item.media.id)
                const startIdx = ids.indexOf(lastClickedId.current)
                const endIdx = ids.indexOf(id)
                if (startIdx !== -1 && endIdx !== -1) {
                    const [from, to] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)]
                    const rangeIds = ids.slice(from, to + 1)
                    setSelectedIds((prev) => {
                        const next = new Set(prev)
                        rangeIds.forEach((rid) => next.add(rid))
                        return next
                    })
                }
                setSelectedId(null)
            } else {
                setSelectedIds(new Set())
                toggleSelect(id)
            }
            lastClickedId.current = id
        },
        [galleryItems, toggleSelect]
    )

    useEffect(() => {
        loadMedia()

        const handleRefresh = (): void => {
            console.log('[GalleryViewModel] Refresh signal received.')
            loadMedia()
        }

        window.addEventListener('gallery-refresh', handleRefresh)
        return () => window.removeEventListener('gallery-refresh', handleRefresh)
    }, [loadMedia])

    useEffect(() => {
        window.api
            ?.getDownloadQueue?.()
            .then((queue: DownloadJob[]) => {
                setDownloadQueue(queue)
            })
            .catch((error: unknown) => {
                console.warn('[GalleryViewModel] Failed to load download queue', error)
            })
    }, [])

    useEffect(() => {
        if (!window.api?.onQueueUpdate) return

        const removeListener = window.api.onQueueUpdate((updateQueue: DownloadJob[]) => {
            setDownloadQueue(updateQueue)
        })

        return () => removeListener?.()
    }, [])

    const toggleFavorite = useCallback(async (id: number) => {
        if (!window.api?.toggleFavorite) return
        const isFav = await window.api.toggleFavorite(id)
        setMedias((prev) => prev.map((m) => (m.id === id ? { ...m, isFavorite: isFav } : m)))
    }, [])

    const deleteMedia = useCallback(async (id: number) => {
        const confirmed = window.confirm('정말 삭제하시겠습니까?')
        if (!confirmed) return

        const target = galleryItems.find((item) => item.media.id === id)

        if(target?.downloadId && target.downloadStatus) {
            if(!window.api?.removeDownloadJob) return
            await window.api.removeDownloadJob(target.downloadId)
            setDownloadQueue((prev) => prev.filter((job) => job.id !== target.downloadId))
            setContextMenu(null)
            return
        }

        if (!window.api?.deleteMedia) return
        await window.api.deleteMedia(id)
        setMedias((prev) => prev.filter((m) => m.id !== id))
        setContextMenu(null)
    }, [galleryItems])

    const selectAll = useCallback(() => {
        const allIds = medias.map((m) => m.id)
        setSelectedIds(new Set(allIds))
        setSelectedId(null)
    }, [medias])

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set())
        setSelectedId(null)
    }, [])

    const handleContextMenu = useCallback((e: React.MouseEvent, mediaId: number) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, mediaId })
    }, [])

    const closeContextMenu = useCallback(() => {
        setContextMenu(null)
    }, [])

    const openTagModal = useCallback((mediaIds: number[]) => {
        setTagModal({ mediaIds })
    }, [])

    const closeTagModal = useCallback(() => {
        setTagModal(null)
    }, [])

    return {
        galleryItems,
        medias,
        selectedId,
        selectedIds,
        contextMenu,
        tagModal,
        isLoading,
        toggleSelect,
        toggleFavorite,
        deleteMedia,
        refresh: loadMedia,
        handleSelect,
        selectAll,
        clearSelection,
        handleContextMenu,
        closeContextMenu,
        openTagModal,
        closeTagModal
    }
}
