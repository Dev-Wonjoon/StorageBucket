import { app, BrowserWindow, dialog } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAppDataPath } from './infrastructure/portablePath'
import type { AppInitializer } from './AppInitializer'

let initializer: AppInitializer | undefined

app.on('second-instance', () => {
  initializer?.createWindow()
})

app.whenReady().then(async () => {
  try {
    const dataPath = getAppDataPath()

    mkdirSync(dataPath, { recursive: true })

    app.setPath('userData', dataPath)
    app.setPath('sessionData', join(dataPath, 'session'))
    app.setPath('crashDumps', join(dataPath, 'crash_dumps'))
    app.setPath('logs', join(dataPath, 'logs'))

    if (!app.requestSingleInstanceLock()) {
      app.quit()
      return
    }

    // 설정을 사용하는 모듈도 경로 확정 뒤에 불러온다.
    const { AppInitializer } = await import('./AppInitializer')

    const next = new AppInitializer()
    await next.initialize()

    initializer = next
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error)

    console.error('[Main] Initialization failed:', error)

    dialog.showErrorBox(
      '프로그램 초기화 실패',
      `프로그램을 시작하지 못했습니다.\n\n${message}\n\n앱을 종료합니다.`
    )

    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    initializer?.createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})