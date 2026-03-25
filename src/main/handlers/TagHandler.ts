import { IpcMainInvokeEvent } from "electron";
import { TagService } from "../services/TagService";

export const tagHandler = {
    'tag:get-all': async () => {
        return await TagService.getAll();
    },

    'tag:get-by-media': async (_: IpcMainInvokeEvent, mediaId: number) => {
        return await TagService.getByMediaId(mediaId);
    },

    'tag:create': async(_: IpcMainInvokeEvent, name: string) => {
        return await TagService.create(name);
    },

    'tag:rename': async(_: IpcMainInvokeEvent, tagId: number, newName: string) => {
        return await TagService.rename(tagId, newName);
    },

    'tag:delete': async(_: IpcMainInvokeEvent, tagId: number) => {
        return await TagService.delete(tagId);
    },

    'tag:add-to-media': async(_: IpcMainInvokeEvent, mediaId: number, tagNames: string[]) => {
        await TagService.addToMedia(mediaId, tagNames);
        return await TagService.getByMediaId(mediaId);
    },

    'tag:remove-from-media': async(_: IpcMainInvokeEvent, mediaId: number, tagId: number) => {
        await TagService.removeFromMedia(mediaId, tagId);
        return await TagService.getByMediaId(mediaId);
    },

    'tag:bulk-add': async(_: IpcMainInvokeEvent, mediaIds: number[], tagNames: string[]) => {
        await TagService.bulkAddToMedias(mediaIds, tagNames);
    },

    'tag:bulk-remove': async(_: IpcMainInvokeEvent, mediaIds: number[], tagIds: number[]) => {
        await TagService.bulkRemoveFromMedias(mediaIds, tagIds);
    },

    'tag:bulk-replace': async(_: IpcMainInvokeEvent, mediaIds: number[], tagNames: string[]) => {
        await TagService.bulkReplaceOnMedias(mediaIds, tagNames);
    },
};