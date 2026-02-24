import { DownloadOptions } from "../../shared/types";
import path from 'path';
import { isFastDomain, isInstagramDomain} from "./DelayStrategy";

export const buildYtdlpArgs = (url: string, basePath: string, options: DownloadOptions): string[] => {
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

    return args;
}