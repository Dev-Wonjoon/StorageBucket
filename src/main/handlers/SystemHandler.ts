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

    'system:engine-install': async (_: IpcMainInvokeEvent, engine: string) => {
        return await BinManager.getInstance().downloadEngine(engine as any);
    },

    'system:engine-licenses': async () => {
        return BinManager.getInstance().getLicenses();
    },

    'system:engine-status': async () => {
        const bin = BinManager.getInstance();
        const engines = Object.keys(bin.getEngineRegistry()) as Array<'yt-dlp' | 'gallery-dl' | 'ffmpeg'>;

        const status: Record<string, { installed: boolean; version: string | null; }> = {};
        for(const name of engines) {
            status[name] = {
                installed: bin.checkExists(name),
                version: await bin.getInstalledVersion(name),
            };
        }
        return status;
    },
};