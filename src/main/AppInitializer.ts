import fs from 'fs';
import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

import { initDB, createFtsTable, rebuildFtsIndex, getFtsCount, getMediaCount } from '../database/index';
import { setupMediaProtocol } from './utils/protocol';
import { DownloadManager } from './managers/DownloadManager';

import { downloadHandler } from './handlers/DownloadHandler';
import { favoriteHandler } from './handlers/FavoriteHandler';
import { mediaHandler } from './handlers/MediaHandler';
import { systemHandler } from './handlers/SystemHandler';
import { tagHandler } from './handlers/TagHandler';
import { searchHandler } from './handlers/SearchHandler';
import { getPortableDataPath } from './utils/portablePath';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>;

const APP_USER_MODEL_ID = 'com.storagebucket.app';

export class AppInitializer {
    private mainWindow: BrowserWindow | null = null;

    public async initialize(): Promise<void> {
        this.setupDataPaths();

        try {
            initDB();
        } catch(error) {
            console.error('DB Initialization Failed:', error);
        }

        try {
            createFtsTable();
            if (getFtsCount() === 0 && getMediaCount() > 0) {
                console.log('[FTS] Rebuilding index for existing data...');
                rebuildFtsIndex();
            }
            console.log('[FTS] FTS5 initialized.');
        } catch(error) {
            console.error('[FTS] Initialization failed:', error);
        }

        electronApp.setAppUserModelId(APP_USER_MODEL_ID);
        
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
            icon: this.resolveWindowIconPath(),
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                sandbox: false,
            }
        });

        DownloadManager.getInstance().setWindow(this.mainWindow);

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

    private resolveWindowIconPath(): string | undefined {
        const candidates = [
            join(process.cwd(), 'build', 'icon.ico'),
            join(process.resourcesPath, 'icon.ico'),
        ];

        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    private setupDataPaths(): void {
        // const basePath = app.getAppPath();
        const portableDataPath = getPortableDataPath();

        app.setPath('userData', portableDataPath);
        app.setPath('sessionData', join(portableDataPath, 'session'));
        app.setPath('crashDumps', join(portableDataPath, 'crash_dumps'));
        app.setPath('logs', join(portableDataPath, 'logs'));

        console.log(`[AppInitializer] User data path set to: ${portableDataPath}`);
    }

    private registerIpcHandlers(): void {
        const handlers = {
            ...downloadHandler,
            ...favoriteHandler,
            ...mediaHandler,
            ...systemHandler,
            ...tagHandler,
            ...searchHandler,
        };

        console.log(`[Main] Found ${Object.keys(handlers).length} handlers to register.`);

        for(const [channel, listener] of Object.entries(handlers)) {
            if(ipcMain.eventNames().includes(channel)) {
                ipcMain.removeHandler(channel);
            }
            const typedListener = listener as IpcHandler;
            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    return await typedListener(event, ...args);
                } catch(error) {
                    console.error(`[IPC Error] ${channel}:`, error);
                    throw error;
                }
            });

            console.log(`[IPC] Registered: ${channel}`);
        }

    }
}
