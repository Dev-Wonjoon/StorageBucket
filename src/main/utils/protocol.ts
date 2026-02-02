import { protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';

export function setupMediaProtocol() {
    protocol.handle('media', (request) => {
        // 1. 프로토콜 접두사 제거 (media://)
        let rawPath = request.url.replace(/^media:\/\//, '');

        // 2. URL 디코딩
        const decodedPath = decodeURIComponent(rawPath);

        let finalPath = decodedPath;

        // 3. 윈도우 드라이브 문자 앞의 슬래시 제거
        if(process.platform === 'win32' && finalPath.startsWith('/') && /^[a-zA-z]:/.test(finalPath.slice(1))) {
            finalPath = finalPath.slice(1);
        }

        try {
            return net.fetch(pathToFileURL(finalPath).toString());
        } catch(error) {
            console.error('[MediaService] Error loading:', finalPath, error);
            return new Response('Not found', { status: 404 });
        }
    });
}