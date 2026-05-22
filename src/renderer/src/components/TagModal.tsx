import { type ReactElement, useState, useEffect, useCallback, useRef } from 'react'
import { BaseModal } from './ui/BaseModal'

interface Tag {
    id: number
    name: string
}

interface TagModalProps {
    mediaIds: number[]
    onClose: () => void
    onUpdated?: () => void
}

export const TagModal = ({ mediaIds, onClose, onUpdated }: TagModalProps): ReactElement => {
    const [allTags, setAllTags] = useState<Tag[]>([])
    const [mediaTags, setMediaTags] = useState<Tag[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const inputRef = useRef<HTMLInputElement>(null)

    const isSingle = mediaIds.length === 1

    const loadTags = useCallback(async () => {
        setIsLoading(true)
        try {
            const all = await window.api.getAllTags()
            setAllTags(all)

            if (isSingle) {
                const tags = await window.api.getMediaTags(mediaIds[0])
                setMediaTags(tags)
            }
        } catch (error) {
            console.error('[TagModal] Failed to load tags', error)
        } finally {
            setIsLoading(false)
        }
    }, [mediaIds, isSingle])

    useEffect(() => {
        loadTags()
        inputRef.current?.focus()
    }, [loadTags])

    // 태그 추가
    const handleAddTag = async (): Promise<void> => {
        const name = input.trim()
        if (!name) return

        try {
            if (isSingle) {
                const updated = await window.api.addTagsToMedia(mediaIds[0], [name])
                setMediaTags(updated)
            } else {
                await window.api.bulkAddTags(mediaIds, [name])
            }

            const all = await window.api.getAllTags()
            setAllTags(all)
            setInput('')
            onUpdated?.()
        } catch (error) {
            console.error('[TagModal] Failed to add tag', error)
        }
    }

    // 미디어에서 태그 제거 (단일 미디어)
    const handleRemoveTag = async (tagId: number): Promise<void> => {
        try {
            const updated = await window.api.removeTagFromMedia(mediaIds[0], tagId)
            setMediaTags(updated)
            onUpdated?.()
        } catch (error) {
            console.error('[TagModal] Failed to remove tag', error)
        }
    }

    // 기존 태그 클릭으로 빠른 추가
    const handleQuickAdd = async (tagName: string): Promise<void> => {
        try {
            if (isSingle) {
                const updated = await window.api.addTagsToMedia(mediaIds[0], [tagName])
                setMediaTags(updated)
            } else {
                await window.api.bulkAddTags(mediaIds, [tagName])
            }
            onUpdated?.()
        } catch (error) {
            console.error('[TagModal] Failed to quick-add tag', error)
        }
    }

    // 입력값 기준 자동완성 필터
    const suggestions = input.trim()
        ? allTags.filter(
              (t) =>
                  t.name.toLowerCase().includes(input.toLowerCase()) &&
                  !mediaTags.some((mt) => mt.id === t.id)
          )
        : []

    return (
        <BaseModal onClose={onClose}>
            <div className="flex max-h-[70vh] w-[400px] flex-col border border-slate-200 p-6 dark:border-slate-700">
                <h2 className="mb-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
                    태그 관리
                </h2>
                <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                    {isSingle
                        ? '미디어에 태그를 추가하거나 제거합니다.'
                        : `${mediaIds.length}개 미디어에 태그를 일괄 추가합니다.`}
                </p>

                {/* 태그 입력 */}
                <div className="flex gap-2 mb-4">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                        placeholder="태그 이름 입력 후 Enter"
                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                        onClick={handleAddTag}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
                    >
                        추가
                    </button>
                </div>

                {/* 자동완성 제안 */}
                {suggestions.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-1.5">
                        {suggestions.slice(0, 8).map((tag) => (
                            <button
                                key={tag.id}
                                onClick={() => handleQuickAdd(tag.name)}
                                className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                            >
                                + {tag.name}
                            </button>
                        ))}
                    </div>
                )}

                {/* 현재 미디어 태그 목록 (단일 미디어) */}
                {isSingle && (
                    <div className="flex-1 overflow-y-auto">
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">현재 태그</p>
                        {isLoading ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                불러오는 중...
                            </p>
                        ) : mediaTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {mediaTags.map((tag) => (
                                    <span
                                        key={tag.id}
                                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-950 dark:bg-slate-800 dark:text-slate-100"
                                    >
                                        {tag.name}
                                        <button
                                            onClick={() => handleRemoveTag(tag.id)}
                                            className="hover:text-red-500 transition-colors"
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                태그가 없습니다.
                            </p>
                        )}
                    </div>
                )}

                {/* 닫기 버튼 */}
                <div className="flex justify-end mt-4">
                    <button
                        onClick={onClose}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-950 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </BaseModal>
    )
}
