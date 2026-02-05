import fs from 'fs';
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron';
import { join, dirname } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

import { initDB } from '../database/index';
import { BinManager } from './managers/BinManager';
import { ConfigManager } from './managers/ConfigManager';
import { MediaService } from './services/MediaService';
import { setupMediaProtocol } from './utils/protocol';
import { DownloadManager } from './managers/DownloadManager';

export class AppInitializer {
    private mainWindow: BrowserWindow | null = null;

    public async initialize(): Promise<void> {
        this.setupDataPaths();

        try {
            initDB();
        } catch(error) {
            console.error('DB Initialization Failed:', error);
        }

        electronApp.setAppUserModelId('com.storagebucket');
        
        setupMediaProtocol();
        
        app.on('browser-window-created', (_, window) => {
            optimizer.watchWindowShortcuts(window);
        })

        this.createWindow();
        
        this.registerIpcHandlers();
    }

    public createWindow(): void {
        if(this.mainWindow && !this.mainWindow.isDestroyed()) {
            if(this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.focus();
            return;
        }

        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                sandbox: false,
            }
        });

        this.mainWindow.on('ready-to-show', () => {
            this.mainWindow?.show();
        });

        this.mainWindow.webContents.setWindowOpenHandler((details) => {
            shell.openExternal(details.url);
            return { action: 'deny' }
        });

        if(is.dev && process.env['ELECTRON_RENDERER_URL']) {
            this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        } else {
            this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
        }
    }

    private setupDataPaths(): void {
        const basePath = app.getAppPath();
        const rootPath = app.isPackaged ? basePath : process.cwd();

        const portableDataPath = join(rootPath, 'data');
        if(!fs.existsSync(portableDataPath)) {
            fs.mkdirSync(portableDataPath, { recursive: true });
        }

        app.setPath('userData', portableDataPath);
        app.setPath('sessionData', join(portableDataPath, 'session'));
        app.setPath('crashDumps', join(portableDataPath, 'crash_dumps'));
        app.setPath('logs', join(portableDataPath, 'logs'));

        console.log(`[AppInitializer] User data path set to: ${portableDataPath}`);
    }

    private registerIpcHandlers(): void {
        ipcMain.handle('media:get-all', async () => {
            return await MediaService.getAll();
        })

        ipcMain.handle('get-download-path', () => {
            return ConfigManager.getInstance().getDownloadPath();
        })

        ipcMain.handle('set-download-path', async () => {
            const result = await dialog.showOpenDialog({
                properties: ['openDirectory']
            });

            if(!result.canceled && result.filePaths.length > 0) {
                const newPath = result.filePaths[0];
                ConfigManager.getInstance().setDownloadPath(newPath);
                return newPath;
            }
            return null;
        })

        ipcMain.handle('system:download-engine', async (_, version: string) => {
            return await BinManager.getInstance().downloadYtdlp(version);
        });

        ipcMain.handle('video:download', async (_event, url: string, options: any) => {
            try {
                console.log(`[IPC] Received download request: ${url}`);

                await DownloadManager.getInstance().addJob(url, options || {});

                return { success: true, message: "Download added to queue" };
            } catch(error) {
                console.error('[IPC] Download Error:', error);
                return { success: false, error: (error as Error).message };
            }
        })
    }
}