import { app, BrowserWindow, dialog } from 'electron';
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

        const message = error instanceof Error ? error.message : String(error)

        dialog.showErrorBox(
            '데이터베이스 업데이트 실패',
            `데이터베이스를 업데이트하지 못했습니다. \n\n${message}\n\n앱을 종료합니다.`
        )

        app.quit()
        return
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