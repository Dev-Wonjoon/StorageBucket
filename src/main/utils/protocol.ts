import { protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';

export function setupMediaProtocol() {
    protocol.handle('media', (request) => {
        const rawUrl = request.url.replace('media:///', '');

        const decodedPath = decodeURIComponent(rawUrl);

        return net.fetch(pathToFileURL(decodedPath).toString());
    });
}