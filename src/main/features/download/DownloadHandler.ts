import type { IpcMainInvokeEvent } from 'electron'
import {
  downloadFailure,
  type DownloadResponse,
  type DownloadServicePort
} from '../../../shared/download-api'

export function createDownloadHandlers(
  resolveService: () => DownloadServicePort | undefined,
  reportUnexpected: (error: unknown) => void = () => {}
) {
  async function execute<T>(
    action: (
      service: DownloadServicePort
    ) => Promise<DownloadResponse<T>>
  ): Promise<DownloadResponse<T>> {
    try {
      const service = resolveService()

      return service
        ? await action(service)
        : downloadFailure('NOT_READY')
    } catch (error) {
      try {
        reportUnexpected(error)
      } catch {
        // 오류 보고 실패가 응답을 바꾸지 않게 한다.
      }

      return downloadFailure('INTERNAL_ERROR')
    }
  }

  return {
    'download:enqueue': async (
      _event: IpcMainInvokeEvent,
      request: unknown
    ) => execute((service) => service.enqueue(request)),

    'download:list': async (
      _event: IpcMainInvokeEvent,
      request: unknown = {}
    ) => execute((service) => service.list(request)),

    'download:get': async (
      _event: IpcMainInvokeEvent,
      request: unknown
    ) => execute((service) => service.get(request)),

    'download:run': async (
      _event: IpcMainInvokeEvent,
      request: unknown
    ) => execute((service) => service.run(request)),

    'download:cancel': async (
      _event: IpcMainInvokeEvent,
      request: unknown
    ) => execute((service) => service.cancel(request))
  }
}