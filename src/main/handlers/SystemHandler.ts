import { dialog, IpcMainInvokeEvent } from 'electron'
import { ConfigManager } from '../managers/ConfigManager'
import { EngineManager } from '../managers/EngineManager'

export const systemHandler = {
    'get-download-path': async () => {
        return ConfigManager.getInstance().getDownloadPath()
    },

    'set-download-path': async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        })

        if (!result.canceled && result.filePaths.length > 0) {
            const newPath = result.filePaths[0]
            ConfigManager.getInstance().setDownloadPath(newPath)
            return newPath
        }
        return null
    },

    'system:engine-install': async (_: IpcMainInvokeEvent, engine: string) => {
        return await EngineManager.getInstance().installEngine(engine as any)
    },

    'system:engine-licenses': async () => {
        return EngineManager.getInstance().getLicense()
    },

    'system:engine-status': async () => {
        const manager = EngineManager.getInstance()
        const engines = Object.keys(manager.getRegistry()) as Array<
            'yt-dlp' | 'gallery-dl' | 'ffmpeg'
        >

        const status: Record<string, { installed: boolean; version: string | null }> = {}
        for (const name of engines) {
            status[name] = {
                installed: manager.checkExists(name),
                version: await manager.getInstalledVersion(name)
            }
        }
        return status
    },

    'system:get-cookie-browser': async () => {
        return ConfigManager.getInstance().getCookieBrowser()
    },

    'system:set-cookie-browser': async (_: IpcMainInvokeEvent, browser: string) => {
        ConfigManager.getInstance().setCookieBrowser(browser)
        return true
    },

    'system:get-cookie-file': async () => {
        return ConfigManager.getInstance().getCookieFilePath()
    },

    'system:set-cookie-file': async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Cookie File', extensions: ['txt'] }]
        })

        if (!result.canceled && result.filePaths.length > 0) {
            ConfigManager.getInstance().setCookieFilePath(result.filePaths[0])
            return result.filePaths[0]
        }
        return null
    },

    'system:clear-cookie-file': async () => {
        ConfigManager.getInstance().setCookieFilePath('')
        return true
    }
}
