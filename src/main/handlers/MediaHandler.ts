import { BrowserWindow, shell } from 'electron';
import { MediaService } from "../services/MediaService";

export const mediaHandler = {
    'media:get-all': async () => {
        return await MediaService.getAll();
    },

    'media:delete': async (_: Electron.IpcMainInvokeEvent, id: number) => {
        return await MediaService.delete(id);
    },

    'shell:show-item': (_: Electron.IpcMainInvokeEvent, filepath: string) => {
        shell.showItemInFolder(filepath);

        const win = BrowserWindow.getFocusedWindow();
        if(win) win.blur();
    }
}