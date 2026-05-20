import type { ExternalMediaStructure } from "./external_structure";

export interface YtdlpStructure extends ExternalMediaStructure {
    downloader: 'yt-dlp';

    extractor?: string;
    extractor_key?: string;

    fulltitle?: string;
    original_url?: string;

    ext?: string;

    duration?: number;
    duration_string?: string;

    filesize_approx?: number;

    thumbnails?: YtdlpThumbnail[];

    channel_url?: string;

    timestamp?: number;
    upload_date?: string;

    view_count?: number;
    like_count?: number;

    comment_count?: number;
    categories: string;
    tags?: string[];

    playlist_id?: string;
    playlist_title?: string;
    playlist_index?: number;

    requested_downloads?: YtdlpRequestedDownload[];
}

export interface YtdlpThumbnail {
    id?: string;
    url?: string;
    preference?: number;
    width?: number;
    height?: number;
    resolution?: string;
}

export interface YtdlpRequestedDownload {
    filepath?: string;
    filename?: string;
    ext?: string;
    filesize?: number;
    filesize_approx?: number;
}