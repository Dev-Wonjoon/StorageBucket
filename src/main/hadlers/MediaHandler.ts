import { ipcMain } from "electron";
import { CHANNELS, MediaSearchRequest } from "../../shared/types";
import { MediaService } from "../services/MediaService";

export function setupMediaHandlers() {
    ipcMain.handle(CHANNELS.SEARCH_MEDIAS, async (_, request: MediaSearchRequest) => {
        try {
            const result = await MediaService.search(request);
            return result;
        } catch(error: any) {
            console.error('[Media Handler Error]', error);
            throw error;
        }
    });
}