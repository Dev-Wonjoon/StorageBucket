import type { EngineInfo, EngineName } from "./engineType"; 

export const ENGINE_REGISTRY: Record<EngineName, EngineInfo> = {
    'yt-dlp': {
        name: 'yt-dlp',
        repo: 'yt-dlp/yt-dlp',
        provider: 'github',
        getAssetCandidates: (platform) => [platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'],
        license: {
            name: 'Unlicense',
            url: 'https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE',
            notice: 'yt-dlp is released into the public domain under the Unlicense.',
        },
    },
    'gallery-dl': {
        name: 'gallery-dl',
        repo: 'mikf/gallery-dl',
        provider: 'codeberg',
        getAssetCandidates: (platform) =>
            platform === 'win32'
                ? ['gallery-dl.exe', 'gallery-dl_x64.exe', 'gallery-dl_x86.exe']
                : ['gallery-dl.bin', 'gallery-dl'],
        license: {
            name: 'GPL-2.0',
            url: 'https://codeberg.org/mikf/gallery-dl/src/branch/master/LICENSE',
            notice: 'gallery-dl is licensed under the GNU General Public License',
        },
    },
    ffmpeg: {
        name: 'ffmpeg',
        repo: 'BtbN/FFmpeg-Builds',
        provider: 'github',
        getAssetCandidates: (platform) => {
            if (platform === 'win32') return ['ffmpeg-master-latest-win64-gpl.zip']
            if (platform === 'darwin') return ['ffmpeg-master-latest-darwin-gpl.zip']
            return ['ffmpeg-master-latest-linux64-gpl.tar.xz']
        
        },
        license: {
            name: 'GPL-2.0 / LGPL-2.1',
            url: 'https://github.com/BtbN/FFmpeg-Builds/blob/master/LICENSE',
            notice: 'FFmpeg is licensed under GPL/LGPL. Source code is available at https://ffmpeg.org.',
        },
    },
}
