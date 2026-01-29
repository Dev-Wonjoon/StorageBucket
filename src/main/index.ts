import { app, BrowserWindow } from 'electron';
import { AppInitializer } from './AppInitializer';

let initializer: AppInitializer;

app.whenReady().then(async () => {
    console.log('[Main] App is ready. Starting initialization...');
    
    try {
        initializer = new AppInitializer();
        await initializer.initialize();
        console.log('[Main] AppInitializer initialized successfully.');
    } catch(error) {
        console.error('[Main] CRITICAL INITIALIZATION ERROR:', error);
    }

    app.on('activate', function () {
        if(BrowserWindow.getAllWindows().length === 0) {
            initializer.createWindow();
        }
    })
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit();
    }
})