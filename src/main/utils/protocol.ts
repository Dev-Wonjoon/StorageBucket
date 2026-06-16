import { protocol, net } from 'electron'
import path from 'path';
import { pathToFileURL } from 'url'
import { ConfigManager } from '../managers/ConfigManager';

export function setupMediaProtocol() {
    protocol.handle('media', (request) => {
        if(!request.url.startsWith('media://')) {
            return new Response('Bad request', { status: 400 })
        }


        // 1. 프로토콜 접두사 제거 (media://)
        let rawPath = request.url.replace(/^media:\/\//, '')

        // 2. URL 디코딩
        const decodedPath = decodeURIComponent(rawPath)

        let finalPath = decodedPath

        // 3. 윈도우 드라이브 문자 앞의 슬래시 제거
        if (
            process.platform === 'win32' &&
            finalPath.startsWith('/') &&
            /^[a-zA-z]:/.test(finalPath.slice(1))
        ) {
            finalPath = finalPath.slice(1)
        }

        try {
            const resolvedPath = path.resolve(finalPath)
            const config = ConfigManager.getInstance()
            const allowedRoots = [
                path.resolve(config.getDownloadPath()),
                path.resolve(config.getThumbnailPath())
            ]

            const isAllowed = allowedRoots.some((root) => {
                const relative = path.relative(root, resolvedPath)
                return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
            })

            if(!isAllowed) {
                console.warn('[MediaProtocol] Blocked path outside media roots:', resolvedPath)
                return new Response('Forbidden', { status: 403 })
            }

            return net.fetch(pathToFileURL(resolvedPath).toString())
        } catch (error) {
            console.error('[MediaService] Error loading:', finalPath, error)
            return new Response('Not found', { status: 404 })
        }
    })
}
