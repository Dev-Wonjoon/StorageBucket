import type { IpcMainInvokeEvent } from 'electron'
import type {
    MediaDetailDto,
    MediaPage,
    MediaResult,
    MediaSummaryDto,
    MediaUnregisterResult
} from '../../../shared/media-v2'

export interface MediaServicePort {
    list(request?: unknown): MediaResult<MediaPage<MediaSummaryDto>>

    get(request: unknown): MediaResult<MediaDetailDto>

    edit(request: unknown): MediaResult<MediaSummaryDto>

    unregisterFiles(request: unknown): MediaResult<MediaUnregisterResult>

    unregisterMedia(request: unknown): MediaResult<MediaUnregisterResult>

    suggest(request: unknown): MediaResult<string[]>
}

export function createMediaHandlers(
    resolveService: () => MediaServicePort | undefined,
    reportUnexpected: (error: unknown) => void = (error) => console.error('[MediaHandler]', error)
) {
    function execute<T>(action: (service: MediaServicePort) => MediaResult<T>): MediaResult<T> {
        try {
            const service = resolveService()

            if (!service) {
                return {
                    ok: false,
                    error: {
                        code: 'NOT_READY',
                        message: '미디어 기능을 사용할 준비가 되지 않았습니다.',
                        context: {}
                    }
                }
            }

            return action(service)
        } catch (error) {
            try {
                reportUnexpected(error)
            } catch {
                // 오류 응답을 유지한다.
            }

            return {
                ok: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: '미디어 요청을 처리하지 못했습니다.',
                    context: {}
                }
            }
        }
    }

    return {
        'media:list': async (_event: IpcMainInvokeEvent, request: unknown = {}) =>
            execute((service) => service.list(request)),

        'media:suggest': async (_event: IpcMainInvokeEvent, request: unknown) =>
            execute((service) => service.suggest(request)),

        'media:get': async (_event: IpcMainInvokeEvent, request: unknown) =>
            execute((service) => service.get(request)),

        'media:edit': async (_event: IpcMainInvokeEvent, request: unknown) =>
            execute((service) => service.edit(request)),

        'media:unregister-files': async (_event: IpcMainInvokeEvent, request: unknown) =>
            execute((service) => service.unregisterFiles(request)),

        'media:unregister': async (_event: IpcMainInvokeEvent, request: unknown) =>
            execute((service) => service.unregisterMedia(request))
    }
}

// 기존 화면·다운로드 호출부의 전환이 끝나면 제거한다.
// 새 명령은 위 factory에 주입한 서비스만 사용한다.
export const shellHandler = {
    'shell:show-item': async (_event: IpcMainInvokeEvent, filepath: string) => {
        const { BrowserWindow, shell } = await import('electron')

        shell.showItemInFolder(filepath)
        BrowserWindow.getFocusedWindow()?.blur()
    }
}
