import { app } from 'electron'
import path from 'path'
import Store from 'electron-store'

interface AppConfig {
    basePath: string
    downloadPath: string
    thumbnailPath: string
    cookieBrowser: string
    cookieFilePath: string
}

export class ConfigManager {
    private static instance: ConfigManager
    private store: Store<AppConfig>

    private constructor() {
        const isDev = !app.isPackaged
        const defaultBasePath = isDev ? app.getAppPath() : path.dirname(app.getPath('exe'))

        const AppStore = (Store as any).default || Store

        this.store = new AppStore({
            defaults: {
                basePath: defaultBasePath,
                downloadPath: path.join(defaultBasePath, 'downloads'),
                thumbnailPath: path.join(defaultBasePath, 'thumbnails'),
                cookieBrowser: '',
                cookieFilePath: ''
            }
        })
    }
    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager()
        }
        return ConfigManager.instance
    }

    public getBasePath(): string {
        return this.store.get('basePath')
    }

    public setBasePath(newPath: string): void {
        this.store.set('basePath', newPath)

        this.store.set('downloadPath', path.join(newPath, 'downloads'))
        this.store.set('thumbnailPath', path.join(newPath, 'thumbnails'))
    }

    public getDownloadPath(): string {
        const savedPath = this.store.get('downloadPath')
        const basePath = this.getBasePath()
        const defaultDownloadPath = path.join(basePath, 'downloads')

        if (!savedPath || savedPath === basePath) {
            this.store.get('downloadedPath', defaultDownloadPath)
            return defaultDownloadPath
        }

        return this.store.get('downloadPath')
    }

    public setDownloadPath(path: string): void {
        this.store.set('downloadPath', path)
        console.log(`[Config] Download path changed: ${path}`)
    }

    public getThumbnailPath(): string {
        return this.store.get('thumbnailPath')
    }

    public setThumbnailPath(path: string): void {
        this.store.set('thumbnailPath', path)
        console.log(`[Config] Thumbnail path changed: ${path}`)
    }

    public getCookieBrowser(): string {
        return this.store.get('cookieBrowser')
    }

    public setCookieBrowser(browser: string): void {
        this.store.set('cookieBrowser', browser)
        console.log(`[Config] Cookie browser changed: ${browser}`)
    }

    public getCookieFilePath(): string {
        return this.store.get('cookieFilePath')
    }

    public setCookieFilePath(filepath: string): void {
        this.store.set('cookieFilePath', filepath)
        console.log(`[Config] Cookie file path changed: ${filepath}`)
    }

    public getAll(): AppConfig {
        return this.store.store
    }

    public getPath(): string {
        return this.store.path
    }
}
