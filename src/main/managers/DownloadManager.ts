import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { DownloadOptions, DownloadJob} from "../../shared/types";
import { ConfigManager } from "./ConfigManager";
import { downloadVideoTask } from "../handlers/DownloadHandler";
import { MediaService } from "../services/MediaService";
import { calculateJobDelay } from "../utils/DelayStrategy";



export class DownloadManager {
    private static instance: DownloadManager;

    private queue: DownloadJob[] = [];

    private isProcessing = false;

    private mainWindow: BrowserWindow | null = null;

    private constructor() {};

    public static getInstance(): DownloadManager {
        if(!DownloadManager.instance) {
            DownloadManager.instance = new DownloadManager();
        }
        return DownloadManager.instance;
    }

    public setWindow(window: BrowserWindow) {
        this.mainWindow = window;
    }

    public async addJob(url: string, options: DownloadOptions) {
        const job: DownloadJob = {
            id: randomUUID(),
            url,
            options,
            status: 'pending',
            progress: 0
        };

        this.queue.push(job);
        console.log(`[DownloadManager] Job added: ${job.id}`);

        this.notifyQueueUpdate();

        if(!this.isProcessing) {
            this.processQueue();
        }
    }

    private async processQueue() {
        if(this.queue.length === 0 || !this.mainWindow) {
            this.isProcessing = false;
            return;
        }

        const jobIndex = this.queue.findIndex(j => j.status === 'pending');
        if(jobIndex === -1) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const job = this.queue[jobIndex];

        this.queue[jobIndex].status = 'downloading';
        this.notifyQueueUpdate();

        const config = ConfigManager.getInstance();
        const basePath = config.getDownloadPath() || process.cwd();

        console.log(`[DownloadManager] Starting job ${job.id} to ${basePath}`);

        try {
            const result = await downloadVideoTask(
                this.mainWindow.webContents,
                job.url,
                basePath,
                job.options
            );
            
            if(result && result.success) {
                console.log(`[DownloadManager] Saving metadata to DB...`);
            }
            
            try {
                MediaService.registerMedia(
                    result.metadata,
                    result.videoPath,
                    result.thumbnailPath
                );
            } catch(error) {
                console.error(`[DownloadManager] Failed to save to DB:`, error);
            }

            this.queue[jobIndex].status = 'completed';
            this.queue[jobIndex].progress = 100;
            console.log(`[DownloadManager] Job completed: ${job.id}`);
        } catch(error) {
            console.error(`[DownloadManager] Job failed: ${job.id}`, error);
            this.queue[jobIndex].status = 'failed';
        }

        this.notifyQueueUpdate();

        const delay = calculateJobDelay(job.url);

        setTimeout(() => {
            this.processQueue();
        }, delay);
    }

    private notifyQueueUpdate() {
        if(this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('download:queue-update', this.queue);
        }
    }

    public removeJob(jobId: string) {
        this.queue = this.queue.filter(j => j.id !== jobId);
        this.notifyQueueUpdate();
    }

    public clearQueue() {
        this.queue = this.queue.filter(j => j.status === 'downloading');
        this.notifyQueueUpdate();
    }
}