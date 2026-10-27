import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import { getDB, initDB } from '../database/index'
import { MediaRepository } from '@features/media/MediaRepository'
import { MediaService } from '@features/media/MediaService'
import { setupMediaProtocol } from './infrastructure/protocol'
import { createDownloadHandlers } from '@features/download/DownloadHandler'
import { shellHandler, createMediaHandlers, type MediaServicePort } from '@features/media/MediaHandler'
import { systemHandler } from './SystemHandler'
import type { DownloadServicePort } from '../shared/download-api'
import { BinManager } from '@features/engines/BinManager'
import { ConfigManager } from '@features/settings/ConfigManager'
import { createYouTubeDownloadRuntime } from '@features/download/YouTubeDownload'
import { startDownloadThumbnailWorker } from '@features/thumbnail/DownloadThumbnailRuntime'
import { createThumbnailHandlers } from '@features/thumbnail/ThumbnailHandler'
import { DownloadThumbnailRepository } from '@features/thumbnail/DownloadThumbnailRepository'

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>

export class AppInitializer {
    private mainWindow: BrowserWindow | null = null
    private mediaService: MediaServicePort | undefined
    private downloadService: DownloadServicePort | undefined
    private stopThumbnailWorker: (() => void) | undefined

    public async initialize(): Promise<void> {
        try {
            await initDB({
                legacyStorageRoot: ConfigManager.getInstance().getDownloadPath()
            })
        } catch (error) {
            console.error('DB Initialization Failed:', error)
            throw error
        }

        this.mediaService = new MediaService(new MediaRepository(getDB()))
        this.downloadService = createYouTubeDownloadRuntime(getDB(), {
            getStorageRoot: () => ConfigManager.getInstance().getDownloadPath(),

            getBinaries: () => {
                const bin = BinManager.getInstance()

                return {
                    ytDlp: bin.getBinaryPath('yt-dlp'),
                    ffmpeg: bin.getBinaryPath('ffmpeg')
                }
            },

            hostScript: app.isPackaged
                ? join(process.resourcesPath, 'engine-host.ps1')
                : join(app.getAppPath(), 'resources', 'engine-host.ps1'),

            nodeExecutable: process.execPath,

            workingDirectory: app.getPath('userData')
        }).service

        electronApp.setAppUserModelId('com.storagebucket')

        setupMediaProtocol()

        app.on('browser-window-created', (_, window) => {
            optimizer.watchWindowShortcuts(window)
        })

        this.createWindow()
        this.registerIpcHandlers()

        try {
            this.stopThumbnailWorker = startDownloadThumbnailWorker(getDB(), (mediaId) => {
                const window = this.mainWindow

                if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
                    window.webContents.send('media:thumbnail-updated', mediaId)
                }
            })

            app.once('before-quit', () => {
                this.stopThumbnailWorker?.()
                this.stopThumbnailWorker = undefined
            })
        } catch (error) {
            console.error('[ThumbnailWorker] 초기화 실패:', error)
        }
    }

    public createWindow(): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore()
            this.mainWindow.focus()
            return
        }

        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                sandbox: false
            }
        })

        this.mainWindow.on('ready-to-show', () => {
            this.mainWindow?.show()
        })

        this.mainWindow.webContents.setWindowOpenHandler((details) => {
            shell.openExternal(details.url)
            return { action: 'deny' }
        })

        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
            this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        } else {
            this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
        }
    }

    private registerIpcHandlers(): void {
        const handlers = {
            ...shellHandler,
            ...systemHandler,
            ...createMediaHandlers(() => this.mediaService),
            ...createDownloadHandlers(() => this.downloadService),
            ...createThumbnailHandlers(() => new DownloadThumbnailRepository(getDB()))
        }

        console.log(`[Main] Found ${Object.keys(handlers).length} handlers to register.`)

        for (const [channel, listener] of Object.entries(handlers)) {
            if (ipcMain.eventNames().includes(channel)) {
                ipcMain.removeHandler(channel)
            }
            const typedListener = listener as IpcHandler
            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    return await typedListener(event, ...args)
                } catch (error) {
                    console.error(`[IPC Error] ${channel}:`, error)
                    throw error
                }
            })

            console.log(`[IPC] Registered: ${channel}`)
        }
    }
}
