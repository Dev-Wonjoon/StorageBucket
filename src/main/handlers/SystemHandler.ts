import { dialog, IpcMainInvokeEvent } from 'electron'
import { ConfigManager } from '../managers/ConfigManager'
import { BinManager } from '../managers/BinManager'
import { YTDLP_VERSION } from '../services/YtdlpAdapter'
import { GALLERYDL_VERSION } from '../services/GalleryDlAdapter'
import { getDoubleClickInterval } from '../utils/doubleClickInterval'

export const systemHandler = {
    'system:double-click-interval': async () => getDoubleClickInterval(),
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
        if (engine !== 'yt-dlp' && engine !== 'gallery-dl' && engine !== 'ffmpeg') {
            return false
        }

        const version =
            engine === 'yt-dlp'
                ? YTDLP_VERSION
                : engine === 'gallery-dl'
                  ? `v${GALLERYDL_VERSION}`
                  : 'latest'

        return BinManager.getInstance().downloadEngine(engine, version)
    },

    'system:engine-licenses': async () => {
        return BinManager.getInstance().getLicenses()
    },

    'system:engine-status': async () => {
        const bin = BinManager.getInstance()
        const engines = Object.keys(bin.getEngineRegistry()) as Array<
            'yt-dlp' | 'gallery-dl' | 'ffmpeg'
        >

        const status: Record<string, { installed: boolean; version: string | null }> = {}
        for (const name of engines) {
            const version = await bin.getInstalledVersion(name)

            const expectedVersion =
                name === 'yt-dlp'
                    ? YTDLP_VERSION
                    : name === 'gallery-dl'
                      ? GALLERYDL_VERSION
                      : undefined

            status[name] = {
                installed:
                    version !== null &&
                    (expectedVersion === undefined || version === expectedVersion),
                version
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
