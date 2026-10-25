import type {
    MediaDetailDto,
    MediaEditRequest,
    MediaGetRequest,
    MediaListRequest,
    MediaPage,
    MediaResult,
    MediaSummaryDto,
    MediaUnregisterFilesRequest,
    MediaUnregisterRequest,
    MediaUnregisterResult,
    MediaSuggestionRequest
} from './media-v2'

export interface MediaApi {
    list(request?: MediaListRequest): Promise<MediaResult<MediaPage<MediaSummaryDto>>>

    get(request: MediaGetRequest): Promise<MediaResult<MediaDetailDto>>

    edit(request: MediaEditRequest): Promise<MediaResult<MediaSummaryDto>>

    unregisterFiles(
        request: MediaUnregisterFilesRequest
    ): Promise<MediaResult<MediaUnregisterResult>>

    unregisterMedia(request: MediaUnregisterRequest): Promise<MediaResult<MediaUnregisterResult>>

    suggest(request: MediaSuggestionRequest): Promise<MediaResult<string[]>>
}
