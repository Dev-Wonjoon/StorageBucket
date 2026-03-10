import { DownloadOptions, TaskCallbacks, TaskHandle } from "../../shared/types";
import { downloadYtdlp } from "./YtdlpTask";
import { downloadGalleryDl } from "./GalleryDlTask";

const GALLERY_DL_DOMAINS = [
    'instagram.com',
    'www.instagram.com',
    'pixiv.net',
    'www.pixiv.net',
    'danbooru.donmai.us',
    'twitter.com',
    'x.com',
];

function shouldUseGalleryDl(url: string): boolean {
    try {
        const hostname = new URL(url).hostname;
        return GALLERY_DL_DOMAINS.includes(hostname);
    } catch {
        return false;
    }
}

export function resolveDownloadTask(
    url: string,
    basePath: string,
    options: DownloadOptions,
    callbacks: TaskCallbacks
): TaskHandle {
    if(shouldUseGalleryDl(url)) {
        return downloadGalleryDl(url, basePath, callbacks);
    }
    return downloadYtdlp(url, basePath, options, callbacks);
}