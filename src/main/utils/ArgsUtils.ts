import { DownloadOptions } from "../../shared/types";
import path from 'path';
import { isFastDomain, isInstagramDomain} from "./DelayStrategy";

export const buildYtdlpArgs = (
    url: string, basePath: string,
    options: DownloadOptions,
    // changed: yt-dlp needs an explicit ffmpeg location after engines moved to app-local bin.
    ffmpegPath?: string,
): string[] => {
    const isInstagram = isInstagramDomain(url);

    const args = [
        url,
        '--no-check-certificates',
        '--no-warning',
        '--newline',
        '--no-write-thumbnail',
        '--ignore-errors',
        '--no-simulate',
        '--progress',
        '--print-json',
    ];

    if(ffmpegPath) {
        // changed: pass the directory, not ffmpeg.exe itself.
        args.push('--ffmpeg-location', path.dirname(ffmpegPath));
    }

    if(isInstagram) {
        args.push('--yes-playlist');
    } else {
        args.push(options?.playlist ? '--yes-playlist' : '--no-playlist');
    }

    if(isFastDomain(url)) {
        args.push('--min-sleep-interval', '0.5');
        args.push('--max-sleep-interval', '2');
    } else {
        args.push('--min-sleep-interval', '5');
        args.push('--max-sleep-interval', '20');
        args.push('--sleep-request', '3');
    }

    if(options.quality === 'audio') {
        args.push('--extract-audio', '--audio-format', options.extension || 'mp3', '--format', 'bestaudio/best');
    } else if(isInstagram) {
        args.push('--format', 'best');
    } else {
        let formatString = 'bestvideo+bestaudio/best';

        switch (options.quality) {
            case '8k': formatString = 'bestvideo[height<=4320]+bestaudio/best[height<=4320]'; break;
            case '4k': formatString = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]'; break;
            case '2k': formatString = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]'; break;
            case '1080': formatString = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]'; break;
            case '720': formatString = 'bestvideo[height<=720]+bestaudio/best[height<=720]'; break;
            case '480': formatString = 'bestvideo[height<=480]+bestaudio/best[height<=480]'; break;
            default: formatString = 'bestvideo+bestaudio/best'; break;
        }

        args.push('--format', formatString);
        args.push('--merge-output-format', options.extension || 'mp4');
    }

    let outputTemplate: string;

    if(isInstagram) {
        outputTemplate = path.join(
            basePath,
            '%(extractor)s',
            '%(uploader_id)s',
            '%(title).50s_%(id)s_%(playlist_index|0)s.%(ext)s'
        );
    } else {
        outputTemplate = path.join(
            basePath,
            '%(extractor)s',
            '%(uploader_id)s',
            '%(title)s_%(id)s.%(ext)s'
        );
    }

    args.push('-o', outputTemplate);

    if(options.excludeIds && options.excludeIds.length > 0) {
        const pattern = options.excludeIds.join('|');
        args.push('--match-filter', `id !~= "^(${pattern}$")`);
    }

    return args;
}

const SHORT_DOMAIN_MAP: Record<string, string> = {
    'youtu.be': 'youtube',
    't.co': 'x',
    'x.com': 'x',
    'fxtwitter.com': 'x',
    'vxtwitter.com': 'x',
    'vm.tiktok.com': 'x',
    'pin.it': 'pinterest',
};

export function extractSiteKey(url: string): string {
    try {
        const hostname = new URL(url).hostname.replace('www', '');
        if(SHORT_DOMAIN_MAP[hostname]) return SHORT_DOMAIN_MAP[hostname];
        const parts = hostname.split('.');
        return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    } catch {
        return 'unknown';
    }
}

export function cleanUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'igsh', 'igshid', 'fbclid', 'si', 'feature', 'img_index'];
        trackingParams.forEach(p => url.searchParams.delete(p));

        return url.toString();
    } catch {
        return rawUrl;
    }
}
