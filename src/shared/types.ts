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
    isFavorite?: boolean;

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
    excludeIds?: string[];
}

export interface DownloadJob {
    id: string;
    url: string;
    options: DownloadOptions;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    progress?: number;
    title?: string;
    thumbnail?: string;
    errorMessage?: string;
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

    keyword?: string;
    title?: string;
    tags?: string | string[];
    tagMode?: 'and' | 'or';
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

export interface GalleryItem {
    media: Media;
    isDownloading: boolean;
    progress?: number;
    speed?: string;
    eta?: string;
    downloadId?: string;
    downloadStatus?: DownloadJob['status'];
    errorMessage?: string;
}

export interface DownloadItem {
    id: string;
    title?: string;
    url?: string;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'failed' | 'error';
    speed?: string;
    eta?: string;
    thumbnail?: string;
    errorMessage?: string;
}

export interface DownloadState {
    queue: DownloadItem[];
    activeCount: number;
    totalProgress: number;
    isDownloading: boolean;
}

export interface TaskCallbacks {
    onProgress: (progress: number, extra?: Record<string, any>) => void;
}

export interface TaskHandle {
    promise: Promise<DownloadResult>;
    abort: () => void;
}

export interface DownloadResult {
    success: boolean;
    multiple: boolean;
    items?: DownloadResultItem[];
    metadata: DownloadResultMetadata | null;
    videoPath: string;
    thumbnailPath: string | null;
}

export interface DownloadResultItem {
    metadata: DownloadResultMetadata;
    videoPath: string;
    thumbnailPath: string | null;
    
}

export interface DownloadResultMetadata {
    id: string;
    title: string;
    extractor_key: string;
    filename: string;
    filesize?: number;
    duration?: number;
    uploader?: string;
    uploader_id?: string;
    uploader_url?: string;
    channel_id?: string;
    channel?: string;
    webpage_url: string;
    thumbnail?: string;
}

export interface EngineStatus {
    installed: boolean;
    version: string | null;
}

export interface LicenseInfo {
    name: string;
    url: string;
    notice: string;
}