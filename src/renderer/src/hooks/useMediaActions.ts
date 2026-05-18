import {
    useState,
    useCallback,
    useRef,
    type Dispatch,
    type MouseEvent,
    type SetStateAction
} from 'react'
import { Media } from 'src/shared/types'

interface MediaActions {
    selectedId: number | null
    selectedIds: Set<number>
    selectAll: () => void
    clearSelection: () => void
    handleSelect: (id: number, e: MouseEvent) => void
    toggleFavorite: (id: number) => Promise<void>
    deleteMedia: (id: number) => Promise<void>
    contextMenu: { x: number; y: number; mediaId: number } | null
    handleContextMenu: (e: MouseEvent, mediaId: number) => void
    closeContextMenu: () => void
    tagModal: { mediaIds: number[] } | null
    openTagModal: (mediaIds: number[]) => void
    closeTagModal: () => void
}

export const useMediaActions = (
    setItems: Dispatch<SetStateAction<Media[]>>,
    items: Media[]
): MediaActions => {
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [contextMenu, setContextMenu] = useState<{
        x: number
        y: number
        mediaId: number
    } | null>(null)
    const [tagModal, setTagModal] = useState<{ mediaIds: number[] } | null>(null)
    const lastClickedId = useRef<number | null>(null)

    const clearSelection = useCallback(() => {
        setSelectedId(null)
        setSelectedIds(new Set())
    }, [])

    const selectAll = useCallback(() => {
        setSelectedId(null)
        setSelectedIds(new Set(items.map((item) => item.id)))
    }, [items])

    const handleSelect = useCallback(
        (id: number, e: MouseEvent) => {
            if (e.ctrlKey || e.metaKey) {
                setSelectedIds((prev) => {
                    const next = new Set(prev)
                    if (selectedId !== null && selectedId !== id) {
                        next.add(selectedId)
                    }
                    if (next.has(id)) next.delete(id)
                    else next.add(id)
                    return next
                })
                setSelectedId(null)
            } else if (e.shiftKey && lastClickedId.current !== null) {
                const ids = items.map((item) => item.id)
                const startIdx = ids.indexOf(lastClickedId.current)
                const endIdx = ids.indexOf(id)

                if (startIdx !== -1 && endIdx !== -1) {
                    const [from, to] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)]
                    setSelectedIds((prev) => {
                        const next = new Set(prev)
                        ids.slice(from, to + 1).forEach((rangeId) => next.add(rangeId))
                        return next
                    })
                }
                setSelectedId(null)
            } else {
                setSelectedIds(new Set())
                setSelectedId((prev) => (prev === id ? null : id))
            }

            lastClickedId.current = id
        },
        [items, selectedId]
    )

    const toggleFavorite = useCallback(
        async (id: number) => {
            if (!window.electron?.ipcRenderer) return
            const isFavorite = await window.electron.ipcRenderer.invoke('favorite:toggle', id)
            setItems((prev) =>
                prev.map((item) => (item.id === id ? { ...item, isFavorite } : item))
            )
        },
        [setItems]
    )

    const deleteMedia = useCallback(
        async (id: number) => {
            const confirmed = window.confirm('?뺣쭚 ??젣?섏떆寃좎뒿?덇퉴?')
            if (!confirmed) return

            if (!window.electron?.ipcRenderer) return
            await window.electron.ipcRenderer.invoke('media:delete', id)
            setItems((prev) => prev.filter((item) => item.id !== id))
            setSelectedId((prev) => (prev === id ? null : prev))
            setSelectedIds((prev) => {
                if (!prev.has(id)) return prev
                const next = new Set(prev)
                next.delete(id)
                return next
            })
            setContextMenu(null)
        },
        [setItems]
    )

    const handleContextMenu = useCallback(
        (e: MouseEvent, mediaId: number) => {
            e.preventDefault()

            const isAlreadySelected = selectedId === mediaId || selectedIds.has(mediaId)
            if (!isAlreadySelected) {
                setSelectedId(mediaId)
                setSelectedIds(new Set())
                lastClickedId.current = mediaId
            }

            setContextMenu({ x: e.clientX, y: e.clientY, mediaId })
        },
        [selectedId, selectedIds]
    )

    const closeContextMenu = useCallback(() => {
        setContextMenu(null)
    }, [])

    const openTagModal = useCallback((mediaIds: number[]) => {
        setTagModal({ mediaIds })
        setContextMenu(null)
    }, [])

    const closeTagModal = useCallback(() => {
        setTagModal(null)
    }, [])

    return {
        selectedId,
        selectedIds,
        selectAll,
        clearSelection,
        handleSelect,
        toggleFavorite,
        deleteMedia,
        contextMenu,
        handleContextMenu,
        closeContextMenu,
        tagModal,
        openTagModal,
        closeTagModal
    }
}
