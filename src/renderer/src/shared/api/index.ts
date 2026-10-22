import type { AppApi } from '../../../../shared/api'

// Resolve the bridge at call time so renderer modules are also importable in tests.
export function getApi(): AppApi {
    if (!window.api) throw new Error('Electron API is not available.')
    return window.api
}
