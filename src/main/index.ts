import { app, BrowserWindow } from 'electron';
import { AppInitializer } from './AppInitializer';

let initializer: AppInitializer;

app.whenReady().then(async () => {
    initializer = new AppInitializer();

    await initializer.initialize();

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