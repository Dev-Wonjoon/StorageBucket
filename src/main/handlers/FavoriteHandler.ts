import { IpcMainInvokeEvent } from "electron";
import { FavoriteService } from "../services/FavoriteService";

export const favoriteHandler = {
    'favorite:get-all': async () => {
        return await FavoriteService.getAll();
    },

    'favorite:toggle': async (_:IpcMainInvokeEvent, mediaId: number) => {
        return await FavoriteService.toggle(mediaId);
    },

    'favorite:check': async (_: IpcMainInvokeEvent, mediaId: number) => {
        return await FavoriteService.isFavorite(mediaId);
    }
}