import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from 'path';
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import fs from 'fs';

const basePath = process.env.PORTABLE_EXECUTABLE_DIR || dirname(app.getPath('exe'));
const rootPath = app.isPackaged ? basePath : process.cwd();
const portableDataPath = join(rootPath, 'data');

if (!fs.existsSync(portableDataPath)) {
  fs.mkdirSync(portableDataPath, { recursive: true });
}

app.setPath('userData', portableDataPath);
app.setPath('sessionData', join(portableDataPath, 'session'));
app.setPath('crashDumps', join(portableDataPath, 'crash_dumps'));
app.setPath('logs', join(portableDataPath, 'logs'));

import { BinManager } from './managers/BinManager';
import { setupMediaProtocol } from "./utils/protocol";
import { MediaService } from "./services/MediaService";

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();

    const binManager = BinManager.getInstance();
    if(!binManager.checkYtdlpExists()) {
      mainWindow.webContents.send('system:need-initial-download');
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' }
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => { 
  electronApp.setAppUserModelId('com.storagebucket')

  setupMediaProtocol();
  
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  ipcMain.handle('system:download-engine', async(_, version: string) => {
    return await BinManager.getInstance().getYtdlpVersions();
  })

  ipcMain.handle('system:get-engine-versions', async () =>{
    return await BinManager.getInstance().getYtdlpVersions();
  })

  ipcMain.handle('media:get-all', async () => {
    return await MediaService.getAll();
  })

  ipcMain.handle('media:delete', async (_, ids: number[]) => {
    return await MediaService.deleteBatch(ids);
  })

  app.on('activate', function () {
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if(process.platform !== 'darwin') {
    app.quit();
  }
});