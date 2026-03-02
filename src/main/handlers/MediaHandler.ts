import { BrowserView, BrowserWindow, shell } from 'electron';
import { MediaService } from "../services/MediaService";

export const mediaHandler = {
    'media:get-all': async () => {
        return await MediaService.getAll();
    },

    'shell:show-item': (_: Electron.IpcMainInvokeEvent, filepath: string) => {
        shell.showItemInFolder(filepath);

        const win = BrowserWindow.getFocusedWindow();
        if(win) win.blur();
    }
}