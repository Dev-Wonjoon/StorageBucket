export interface DownloadItem {
    id: string;
    title: string;
    progress: number;
    status: 'pending' | 'downloading' | 'completed' | 'error';
    speed?: string;
    eta?: string;
}

export interface DownloadState {
    queue: DownloadItem[];
    activeCount: number;
    totalProgress: number;
    isDownloading: boolean;
}