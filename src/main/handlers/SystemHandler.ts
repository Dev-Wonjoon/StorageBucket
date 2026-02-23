import { dialog, IpcMainInvokeEvent } from "electron";
import { ConfigManager } from "../managers/ConfigManager";
import { BinManager } from "../managers/BinManager";

export const systemHandler = {
    'get-download-path': async () => {
        return ConfigManager.getInstance().getDownloadPath();
    },

    'set-download-path': async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if(!result.canceled && result.filePaths.length > 0) {
            const newPath = result.filePaths[0];
            ConfigManager.getInstance().setDownloadPath(newPath);
            return newPath;
        }
        return null;
    },

    'system:download-engine': async (_: IpcMainInvokeEvent, version: string) => {
        return await BinManager.getInstance().downloadYtdlp(version);
    }
};