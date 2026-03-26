import { useState, useEffect, useCallback, useRef } from "react";
import { BaseModal } from "./ui/BaseModal";

interface Tag {
    id: number;
    name: string;
}

interface TagModalProps {
    mediaIds: number[];
    onClose: () => void;
    onUpdated?: () => void;
}

export const TagModal = ({ mediaIds, onClose, onUpdated }: TagModalProps) => {
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [mediaTags, setMediaTags] = useState<Tag[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const inputRef = useRef<HTMLInputElement>(null);

    const isSingle = mediaIds.length === 1;

    const loadTags = useCallback(async () => {
        setIsLoading(true);
        try {
            const all = await window.api.getAllTags();
            setAllTags(all);

            if(isSingle) {
                const tags = await window.api.getMediaTags(mediaIds[0]);
                setMediaTags(tags);
            }
        } catch(error) {
            console.error('[TagModal] Failed to load tags', error);
        } finally {
            setIsLoading(false);
        }
    }, [mediaIds, isSingle]);

    useEffect(() => {
        loadTags();
        inputRef.current?.focus();
    }, [loadTags]);

    // 태그 추가
    const handleAddTag = async () => {
        const name = input.trim();
        if(!name) return;

        try {
            if(isSingle) {
                const updated = await window.api.addTagsToMedia(mediaIds[0], [name]);
                setMediaTags(updated);
            } else {
                await window.api.bulkAddTags(mediaIds, [name]);
            }

            const all = await window.api.getAllTags();
            setAllTags(all);
            setInput("");
            onUpdated?.();
        } catch(error) {
            console.error('[TagModal] Failed to add tag', error);
        }
    };

    // 미디어에서 태그 제거 (단일 미디어)
    const handleRemoveTag = async (tagId: number) => {
        try {
            const updated = await window.api.removeTagFromMedia(mediaIds[0], tagId);
            setMediaTags(updated);
            onUpdated?.();
        } catch(error) {
            console.error('[TagModal] Failed to remove tag', error);
        }
    };

    // 기존 태그 클릭으로 빠른 추가
    const handleQuickAdd = async (tagName: string) => {
        try {
            if(isSingle) {
                const updated = await window.api.addTagsToMedia(mediaIds[0], [tagName]);
                setMediaTags(updated);
            } else {
                await window.api.bulkAddTags(mediaIds, [tagName]);
            }
            onUpdated?.();
        } catch(error) {
            console.error('[TagModal] Failed to quick-add tag', error);
        }
    };

    // 입력값 기준 자동완성 필터
    const suggestions = input.trim()
        ? allTags.filter(
            (t) =>
                t.name.toLowerCase().includes(input.toLowerCase()) &&
            !mediaTags.some((mt) => mt.id === t.id)
        ) : [];
    
    return (
        <BaseModal onClose={onClose}>
            <div className="border border-[var(--border-line)] p-6 w-[400px] max-h-[70vh] flex flex-col">
                <h2 className="text-lg font-semibold text-[var(--text-main)] mb-1">
                    태그 관리
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                    {isSingle ? "미디어에 태그를 추가하거나 제거합니다." : `${mediaIds.length}개 미디어에 태그를 일괄 추가합니다.`}
                </p>

                {/* 태그 입력 */}
                <div className="flex gap-2 mb-4">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                        placeholder="태그 이름 입력 후 Enter"
                        className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-line)] bg-[var(--bg-app)] text-sm text-[var(--text-main)] outline-none focus:border-[var(--color-primary)]"
                    />
                    <button
                        onClick={handleAddTag}
                        className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:opacity-90"
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
                                className="px-2.5 py-1 rounded-full text-xs border border-[var(--border-line)] text-[var(--text-muted)] hover:bg-[var(--bg-active)] hover:text-[var(--text-main)] transition-colors"
                            >
                                + {tag.name}
                            </button>
                        ))}
                    </div>
                )}

                {/* 현재 미디어 태그 목록 (단일 미디어) */}
                {isSingle && (
                    <div className="flex-1 overflow-y-auto">
                        <p className="text-xs text-[var(--text-muted)] mb-2">현재 태그</p>
                        {isLoading ? (
                            <p className="text-sm text-[var(--text-muted)]">불러오는 중...</p>
                        ) : mediaTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {mediaTags.map((tag) => (
                                    <span
                                        key={tag.id}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[var(--bg-active)] text-[var(--text-main)]"
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
                            <p className="text-sm text-[var(--text-muted)]">태그가 없습니다.</p>
                        )}
                    </div>
                )}

                {/* 닫기 버튼 */}
                <div className="flex justify-end mt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl border border-[var(--border-line)] text-[var(--text-main)] text-sm hover:bg-[var(--bg-active)]"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </BaseModal>
    );
}
