import { execFile } from 'node:child_process'
import { join } from 'node:path'

// Query the Win32 API without opening app configuration, registry files or a DB.
// Failure is explicit: the renderer retains its immediate detail button.
export async function getDoubleClickInterval(): Promise<number | null> {
    if (process.platform !== 'win32') return null
    return new Promise((resolve) => {
        execFile(
            join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe'
            ),
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class StorageBucketMouse { [DllImport("user32.dll")] public static extern uint GetDoubleClickTime(); }\'; [StorageBucketMouse]::GetDoubleClickTime()'
            ],
            { windowsHide: true, timeout: 5000, maxBuffer: 1024 },
            (error, stdout) => {
                const value = Number(stdout.trim())
                resolve(
                    !error && Number.isInteger(value) && value >= 1 && value <= 5000 ? value : null
                )
            }
        )
    })
}
