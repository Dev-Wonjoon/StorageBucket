import { IpcMainInvokeEvent } from 'electron'
import { SearchService } from '../services/SearchService'
import { MediaSearchRequest } from '../../shared/types'

export const searchHandler = {
    'search:media': async (_: IpcMainInvokeEvent, request: MediaSearchRequest) => {
        return await SearchService.search(request)
    },
    'search:suggest-authors': async (_: IpcMainInvokeEvent, keyword: string) => {
        return await SearchService.suggestAuthors(keyword)
    },
    'search:suggest-platforms': async (_: IpcMainInvokeEvent, keyword: string) => {
        return await SearchService.suggestPlatforms(keyword)
    },
    'search:suggest-tags': async (_: IpcMainInvokeEvent, keyword: string) => {
        return await SearchService.suggestTags(keyword)
    },
    'search:rebuild-index': async () => {
        return await SearchService.rebuildIndex()
    }
}
