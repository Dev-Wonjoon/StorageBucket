import { useEffect, useRef, useState } from 'react'
import { getApi } from '@renderer/shared/api'
import type { ThumbnailStatusDto } from '../../../../shared/thumbnail-api'

export function MediaThumbnailStatus({
    mediaId,
    fileId,
    title,
    disabled = false
}: {
    mediaId: number
    fileId: number
    title: string
    disabled?: boolean
}): React.JSX.Element | null {
    const [status, setStatus] = useState<ThumbnailStatusDto | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [requesting, setRequesting] = useState(false)
    const [command, setCommand] = useState<{ mode: 'read' | 'retry' }>({
        mode: 'read'
    })

    // React의 다음 렌더링 전에도 연속 클릭을 막는다.
    const requestLock = useRef(false)

    useEffect(() => {
        let active = true
        let timer: ReturnType<typeof setTimeout> | undefined

        const request = { mediaId, fileId }

        async function readStatus(): Promise<void> {
            if (!active) return

            try {
                const result = await getApi().thumbnails.get(request)

                if (!active) return

                if (!result.ok) {
                    setError(result.error.message)
                    return
                }

                setStatus(result.data)

                if (result.data.state === 'pending' || result.data.state === 'running') {
                    timer = setTimeout(() => {
                        void readStatus()
                    }, 2000)
                }
            } catch {
                if (active) {
                    setError('썸네일 상태를 확인하지 못했습니다.')
                }
            }
        }

        async function start(): Promise<void> {
            setError(null)

            try {
                if (command.mode === 'retry') {
                    const result = await getApi().thumbnails.retry(request)

                    if (!active) return

                    if (result.ok) {
                        setStatus(result.data)
                    } else {
                        setError(result.error.message)
                    }
                }

                await readStatus()
            } catch {
                if (active) {
                    setError('썸네일 재시도를 요청하지 못했습니다.')
                }
            } finally {
                if (active) {
                    requestLock.current = false
                    setRequesting(false)
                }
            }
        }

        void start()

        return () => {
            active = false

            if (timer !== undefined) {
                clearTimeout(timer)
            }
        }
    }, [mediaId, fileId, command])

    function request(mode: 'read' | 'retry'): void {
        if (disabled || requestLock.current) return
        if (mode === 'retry' && !status?.canRetry) return

        requestLock.current = true
        setRequesting(true)
        setCommand({ mode })
    }

    if (!error && (status?.state === 'unsupported' || status?.state === 'registered')) {
        return null
    }

    let message = '썸네일 상태 확인 중...'

    switch (status?.state) {
        case 'missing':
            message = '썸네일 생성 작업이 등록되어 있지 않습니다.'
            break

        case 'pending':
            message = '썸네일 생성 대기 중'
            break

        case 'running':
            message = '썸네일 생성 중'
            break

        case 'failed':
            message = status.canRetry
                ? '썸네일을 가져오지 못했습니다.'
                : '썸네일 생성을 완료하지 못했습니다.'
            break

        case 'blocked':
            message = '썸네일 생성이 보류되었습니다.'
            break

        case 'registered':
        case 'unsupported':
            message = ''
            break
    }

    const showRefresh =
        Boolean(error) ||
        status?.state === 'missing' ||
        status?.state === 'blocked' ||
        (status?.state === 'failed' && !status.canRetry)

    const button =
        'rounded-lg border border-[var(--border-line)] px-3 py-2 text-sm disabled:opacity-40'

    return (
        <div
            data-thumbnail-file={fileId}
            data-thumbnail-state={status?.state ?? 'loading'}
            aria-label={`${title} 썸네일 상태`}
            aria-busy={requesting}
            className="space-y-2 text-sm"
        >
            {message && (
                <p role="status" className="text-[var(--text-muted)]">
                    {message}
                </p>
            )}

            {error && <p role="alert">{error}</p>}

            {status?.canRetry && (
                <button
                    type="button"
                    className={button}
                    aria-label={`${title} 썸네일 다시 시도`}
                    disabled={disabled || requesting}
                    onClick={(event) => {
                        event.stopPropagation()
                        request('retry')
                    }}
                >
                    {requesting ? '요청 중...' : '썸네일 다시 시도'}
                </button>
            )}

            {showRefresh && (
                <button
                    type="button"
                    className={button}
                    aria-label={`${title} 썸네일 상태 새로고침`}
                    disabled={disabled || requesting}
                    onClick={(event) => {
                        event.stopPropagation()
                        request('read')
                    }}
                >
                    상태 새로고침
                </button>
            )}
        </div>
    )
}
