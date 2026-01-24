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

export type MediaType = 'video' | 'audio';
export type VideoQuality = 'best' | '1080' | '720';

export interface DownloadOptions {
    type: MediaType;
    quality: VideoQuality;
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