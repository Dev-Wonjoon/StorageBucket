export interface Media {
    id: number;
    title: string;
    filepath: string;
    author?: string | null;
    platform?: string | null;
    url?: string | null;
    filesize?: number | null;
    thumbnailPath?: string | null;
    duration?: number | null;

    platformId: number | null;
    profileId: number | null;

    createdAt: Date;
    updatedAt: Date;
}

export type VideoQuality = 'best' | '8k' | '4k' | '2k' | '1080' | '720' | '480' | 'audio';

export interface DownloadOptions {
    type?: 'video' | 'audio';
    quality?: VideoQuality;
    playlist?: boolean;
    extension?: 'mp4' | 'mp3' | 'mkv';
    skipExisting?: boolean;
}

export interface DownloadJob {
    id: string;
    url: string;
    options: DownloadOptions;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    progress?: number;
    title?: string;
    thumbnail?: string;
}

export interface VideoInfo {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    uploader: string;
    webpage_url?: string;
}

export interface MediaSearchRequest {
    page: number;
    limit: number;

    title?: string;
    tags?: string | string[];
    author?: string | string[];
    platform?: string | string[];

    startDate?: string;
    endDate?: string;
}

export interface MediaSearchResult {
    data: Media[];
    total: number;

    hasNextPage?: boolean;
}

export const CHANNELS = {
    GET_ALL_MEDIAS: 'media:get-all',
    SEARCH_MEDIAS: 'media:search',

    GET_VIDEO_INFO: 'downloader:get-info',
    START_DOWNLOAD: 'downloader:start',
    DOWNLOAD_PROGRESS: 'downloader:progress',
    DOWNLOAD_STATUS: 'downloader:status',
} as const;