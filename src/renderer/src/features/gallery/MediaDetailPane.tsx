import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getApi } from '@renderer/shared/api'
import { useToast } from '@renderer/shared/hooks/useToast'
import { MediaPreview } from '@renderer/shared/components/media/MediaPreview'
import { MEDIA_PAGE_SIZE, type GallerySnapshot, type GalleryStore } from '../gallery/galleryStore'
import { MediaThumbnailStatus } from './MediaThumbnailStatus'

export interface MediaDetailFocusRequest {
    mediaId: number
    field: 'title' | 'tags'
    sequence: number
}

export function MediaDetailPane({
    state,
    store,
    onDirtyChange,
    focusRequest
}: {
    state: GallerySnapshot
    store: GalleryStore
    onDirtyChange: (dirty: boolean) => void
    focusRequest?: MediaDetailFocusRequest | null
}) {
    const { showToast } = useToast()
    const detail = state.detail
    const data = detail.data

    const [draft, setDraft] = useState<{ title: string; revision: number; dirty: boolean } | null>(
        null
    )

    const [newTagName, setNewTagName] = useState('')
    const titleInput = useRef<HTMLInputElement>(null)
    const tagInput = useRef<HTMLInputElement>(null)
    const handledFocus = useRef<number | null>(null)
    useEffect(() => {
        if (
            !focusRequest ||
            focusRequest.mediaId !== data?.id ||
            detail.status !== 'ready' ||
            !draft ||
            handledFocus.current === focusRequest.sequence
        )
            return
        const input = focusRequest.field === 'title' ? titleInput.current : tagInput.current
        if (!input || input.disabled) return
        handledFocus.current = focusRequest.sequence
        input.focus({ preventScroll: true })
        input.scrollIntoView({ block: 'center' })
    }, [focusRequest, data?.id, detail.status, draft])

    const hasDraft = Boolean(draft?.dirty || newTagName.trim())

    useEffect(() => {
        if (!data) return

        setDraft((previous) =>
            previous?.dirty
                ? previous
                : {
                      title: data.customTitle ?? '',
                      revision: data.revision,
                      dirty: false
                  }
        )
    }, [data])

    useLayoutEffect(() => {
        onDirtyChange(hasDraft)
        return () => onDirtyChange(false)
    }, [hasDraft, onDirtyChange])

    const disabled = state.busy || state.needsRefresh || detail.status !== 'ready'

    const staleDraft = Boolean(data && draft && draft.revision !== data.revision)

    async function saveTitle() {
        if (!data || !draft || disabled || staleDraft) {
            return
        }

        const saved = await store.edit({
            mediaId: data.id,
            expectedRevision: draft.revision,
            customTitle: draft.title
        })

        if (saved) {
            const current = store.getSnapshot().detail.data

            setDraft(
                current
                    ? {
                          title: current.customTitle ?? '',
                          revision: current.revision,
                          dirty: false
                      }
                    : null
            )
        }
    }

    async function addTag() {
        if (!data || disabled || !newTagName.trim()) {
            return
        }

        const submitted = newTagName

        const saved = await store.edit({
            mediaId: data.id,
            expectedRevision: data.revision,
            tagChange: {
                addNames: [submitted.trim()]
            }
        })

        if (saved) {
            setNewTagName((current) => (current === submitted ? '' : current))
        }
    }

    function resetDraft() {
        if (!data || state.busy) return

        if (
            draft?.dirty &&
            !window.confirm('작성 중인 제목을 버리고 현재 저장된 제목을 불러올까요?')
        ) {
            return
        }

        setDraft({
            title: data.customTitle ?? '',
            revision: data.revision,
            dirty: false
        })
    }

    async function showFile(filepath: string) {
        try {
            await getApi().showItemInFolder(filepath)
        } catch {
            showToast('파일 위치를 열지 못했습니다.', 'error')
        }
    }

    const button =
        'rounded-lg border border-[var(--border-line)] px-3 py-2 text-sm disabled:opacity-40'

    return (
        <section aria-label="묶음 상세" className="space-y-5">
            {detail.status === 'loading' && <p role="status">상세 정보를 불러오는 중...</p>}

            {detail.error && <p role="alert">{detail.error.message}</p>}

            {detail.status === 'idle' && <p>새로고침하여 상세 정보를 확인하세요.</p>}

            {data && (
                <>
                    <div className="flex flex-col gap-4">
                        <MediaPreview
                            path={data.cover?.path ?? null}
                            title={data.title}
                            className="aspect-video w-full rounded-lg bg-[var(--bg-active)] object-contain"
                        />

                        <div className="min-w-0 flex-1 space-y-2">
                            <h3 className="break-words font-medium">{data.title}</h3>

                            <p className="text-sm text-[var(--text-muted)]">
                                {data.sourceKind === 'local'
                                    ? '로컬 폴더'
                                    : data.sourceKind === 'download'
                                      ? '다운로드'
                                      : '기존 자료'}
                                {' · 파일 ' + data.fileCount + '개'}
                            </p>

                            {data.requestUrl && (
                                <p className="break-all text-sm">{data.requestUrl}</p>
                            )}

                            <p className="text-sm">
                                표지: {data.coverMode === 'manual' ? '사용자 지정' : '자동'}
                            </p>

                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={button}
                                    disabled={disabled}
                                    aria-pressed={data.isFavorite}
                                    onClick={() =>
                                        void store.edit({
                                            mediaId: data.id,
                                            expectedRevision: data.revision,
                                            isFavorite: !data.isFavorite
                                        })
                                    }
                                >
                                    {data.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                                </button>

                                <button
                                    type="button"
                                    className={button}
                                    disabled={disabled || data.coverMode === 'auto'}
                                    onClick={() =>
                                        void store.edit({
                                            mediaId: data.id,
                                            expectedRevision: data.revision,
                                            cover: { mode: 'auto' }
                                        })
                                    }
                                >
                                    표지 자동 선택
                                </button>
                            </div>
                        </div>
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault()
                            void saveTitle()
                        }}
                        className="space-y-2"
                    >
                        <label className="block text-sm">
                            사용자 지정 제목
                            <input
                                ref={titleInput}
                                value={draft?.title ?? ''}
                                disabled={state.busy || !draft}
                                onChange={(event) => {
                                    const title = event.target.value

                                    setDraft((previous) =>
                                        previous
                                            ? {
                                                  ...previous,
                                                  title,
                                                  dirty: true
                                              }
                                            : previous
                                    )
                                }}
                                className="mt-1 w-full rounded-lg border border-[var(--border-line)] bg-[var(--bg-app)] p-2"
                            />
                        </label>

                        {staleDraft && (
                            <p role="alert" className="text-sm">
                                제목을 작성한 뒤 저장된 정보가 변경됐습니다. 초안을 확인하고 저장된
                                제목을 다시 불러오세요.
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="submit"
                                className={button}
                                disabled={disabled || !draft?.dirty || staleDraft}
                            >
                                제목 저장
                            </button>

                            <button
                                type="button"
                                className={button}
                                disabled={state.busy}
                                onClick={resetDraft}
                            >
                                저장된 제목 불러오기
                            </button>

                            <button
                                type="button"
                                className={button}
                                disabled={disabled}
                                onClick={() => {
                                    if (
                                        draft?.dirty &&
                                        !window.confirm(
                                            '작성 중인 제목을 버리고 원본 제목으로 되돌릴까요?'
                                        )
                                    ) {
                                        return
                                    }

                                    void store
                                        .edit({
                                            mediaId: data.id,
                                            expectedRevision: data.revision,
                                            customTitle: null
                                        })
                                        .then((saved) => {
                                            if (!saved) return

                                            const current = store.getSnapshot().detail.data

                                            setDraft(
                                                current
                                                    ? {
                                                          title: current.customTitle ?? '',
                                                          revision: current.revision,
                                                          dirty: false
                                                      }
                                                    : null
                                            )
                                        })
                                }}
                            >
                                원본 제목으로 되돌리기
                            </button>
                        </div>
                    </form>

                    <form
                        className="space-y-2"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void addTag()
                        }}
                    >
                        <h3 className="text-sm font-medium">태그</h3>

                        <div className="flex flex-wrap gap-2">
                            {data.tags.map((tag) => (
                                <span
                                    key={tag.id}
                                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border-line)] px-3 py-1 text-sm"
                                >
                                    {tag.name}

                                    <button
                                        type="button"
                                        disabled={disabled}
                                        aria-label={tag.name + ' 태그 연결 해제'}
                                        onClick={() =>
                                            void store.edit({
                                                mediaId: data.id,
                                                expectedRevision: data.revision,
                                                tagChange: {
                                                    removeIds: [tag.id]
                                                }
                                            })
                                        }
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}

                            {!data.tags.length && (
                                <span className="text-sm text-[var(--text-muted)]">
                                    연결된 태그가 없습니다.
                                </span>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <input
                                ref={tagInput}
                                aria-label="추가할 태그 이름"
                                value={newTagName}
                                disabled={state.busy}
                                onChange={(event) => setNewTagName(event.target.value)}
                                placeholder="태그 이름"
                                className="min-w-0 flex-1 rounded-lg border border-[var(--border-line)] bg-[var(--bg-app)] p-2 text-sm"
                            />

                            <button
                                type="submit"
                                className={button}
                                disabled={disabled || !newTagName.trim()}
                            >
                                추가
                            </button>
                        </div>
                    </form>

                    <div className="space-y-3">
                        <h3 className="font-medium">파일 {data.files.total}개</h3>

                        {data.files.data.map((file) => (
                            <article
                                key={file.id}
                                className="flex flex-col gap-3 rounded-lg border border-[var(--border-line)] p-3"
                            >
                                <MediaPreview
                                    path={
                                        file.thumbnailPath ??
                                        file.previewPath ??
                                        (file.kind === 'image' ? file.filepath : null)
                                    }
                                    title={file.title ?? file.fileKey}
                                    className="aspect-video w-full rounded bg-[var(--bg-active)] object-contain"
                                />

                                {data.sourceKind === 'download' &&
                                    file.storageKind === 'app_managed' &&
                                    (file.kind === 'video' || file.kind === 'audio') &&
                                    file.thumbnailPath === null && (
                                        <MediaThumbnailStatus
                                            key={`${data.id}:${file.id}:${data.revision}`}
                                            mediaId={data.id}
                                            fileId={file.id}
                                            title={file.title ?? file.fileKey}
                                            disabled={disabled}
                                        />
                                    )}

                                <div className="min-w-0 flex-1 space-y-1">
                                    <p className="break-words text-sm">
                                        {file.title ?? file.fileKey}
                                    </p>

                                    <p className="break-all text-xs text-[var(--text-muted)]">
                                        {file.filepath}
                                    </p>

                                    <p className="text-xs text-[var(--text-muted)]">
                                        {file.storageKind === 'external_reference'
                                            ? '외부 원본 참조'
                                            : file.storageKind === 'unverified_legacy'
                                              ? '보관 방식 미확인'
                                              : '앱 관리 파일'}

                                        {file.detectedFormat ? ' · ' + file.detectedFormat : ''}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-start gap-2">
                                    <button
                                        type="button"
                                        className={button}
                                        disabled={state.busy}
                                        onClick={() => void showFile(file.filepath)}
                                    >
                                        파일 위치
                                    </button>

                                    <button
                                        type="button"
                                        className={button}
                                        disabled={disabled}
                                        onClick={() =>
                                            void store.edit({
                                                mediaId: data.id,
                                                expectedRevision: data.revision,
                                                cover: {
                                                    mode: 'manual',
                                                    fileId: file.id
                                                }
                                            })
                                        }
                                    >
                                        표지 지정
                                    </button>

                                    <button
                                        type="button"
                                        className={button}
                                        disabled={disabled}
                                        onClick={() => {
                                            if (
                                                !window.confirm(
                                                    '이 파일의 등록을 해제할까요? 외부 원본과 보관 방식 미확인 원본은 삭제하지 않습니다. 앱 관리 파일의 정리는 별도로 처리합니다.'
                                                )
                                            ) {
                                                return
                                            }

                                            if (
                                                hasDraft &&
                                                !window.confirm(
                                                    '파일 등록 해제로 묶음이 제거되면 작성 중인 제목·태그도 닫힙니다. 계속할까요?'
                                                )
                                            ) {
                                                return
                                            }

                                            void store.unregisterFiles({
                                                mediaId: data.id,
                                                expectedRevision: data.revision,
                                                fileIds: [file.id]
                                            })
                                        }}
                                    >
                                        등록 해제
                                    </button>
                                </div>
                            </article>
                        ))}

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                className={button}
                                disabled={disabled || detail.offset === 0}
                                onClick={() =>
                                    void store.loadDetail(
                                        Math.max(0, detail.offset - MEDIA_PAGE_SIZE)
                                    )
                                }
                            >
                                이전 파일
                            </button>

                            <span className="text-sm">
                                {Math.floor(detail.offset / MEDIA_PAGE_SIZE) + 1}
                                {' 페이지'}
                            </span>

                            <button
                                type="button"
                                className={button}
                                disabled={disabled || !data.files.hasNextPage}
                                onClick={() =>
                                    void store.loadDetail(detail.offset + MEDIA_PAGE_SIZE)
                                }
                            >
                                다음 파일
                            </button>
                        </div>
                    </div>

                    <button
                        type="button"
                        className={button + ' text-red-500'}
                        disabled={disabled}
                        onClick={() => {
                            if (
                                !window.confirm(
                                    '묶음의 등록을 해제할까요? 외부 원본과 보관 방식 미확인 원본은 삭제하지 않습니다. 앱 관리 파일의 정리는 별도로 처리합니다.'
                                )
                            ) {
                                return
                            }

                            if (
                                hasDraft &&
                                !window.confirm('작성 중인 제목·태그가 닫힙니다. 계속할까요?')
                            ) {
                                return
                            }

                            void store.unregisterMedia({
                                mediaId: data.id,
                                expectedRevision: data.revision
                            })
                        }}
                    >
                        묶음 등록 해제
                    </button>
                </>
            )}
        </section>
    )
}
