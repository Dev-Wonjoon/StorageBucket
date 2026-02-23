import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { DownloadOptions, DownloadJob} from "../../shared/types";
import { ConfigManager } from "./ConfigManager";
import { downloadVideoTask } from "../handlers/DownloadHandler";
import { MediaService } from "../services/MediaService";
import { calculateJobDelay } from "../utils/DelayStrategy";
import { downloadQueue } from "../../database/schema";
import { ne, eq } from "drizzle-orm";
import { db } from "../../database";



export class DownloadManager {
    private static instance: DownloadManager;

    private queue: DownloadJob[] = [];

    private isProcessing = false;

    private mainWindow: BrowserWindow | null = null;

    private constructor() {
        this.restoreQueue();
    };

    private async restoreQueue() {
        try {
            const savedJobs = await db.select().from(downloadQueue).where(ne(downloadQueue.status, 'completed'));

            this.queue = savedJobs.map(job => ({
                id: job.id,
                url: job.url,
                status: job.status as any,
                progress: job.progress || 0,
                options: JSON.parse(job.options as string || '{}')
            }));

            let needsUpdate = false;
            this.queue.forEach(job => {
                if(job.status === 'downloading') {
                    job.status = 'pending';
                    job.progress = 0;

                    db.update(downloadQueue)
                        .set({ status: 'pending', progress: 0 })
                        .where(eq(downloadQueue.id, job.id))
                        .run();
                    
                    needsUpdate = true;
                }
            });

            console.log(`[DownloadManager] Restored ${this.queue.length} jobs from DB.`);

            if(this.queue.length > 0) {
                this.processQueue();
            }
        } catch(error) {
            console.error('[DownloadManager] Failed to restore queue:', error);
        }
    }

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
        const id = randomUUID();
        const job: DownloadJob = {
            id,
            url,
            options,
            status: 'pending',
            progress: 0
        };

        this.queue.push(job);

        try {
            await db.insert(downloadQueue).values({
                id: job.id,
                url: job.url,
                status: 'pending',
                options: JSON.stringify(options),
                progress: 0,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        } catch(error) {
            console.error('[DownloadManager] DB Insert Failed:', error);
        }

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

        this.updateJobStatus(job.id, 'downloading');
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
                try {
                    MediaService.registerMedia(
                        result.metadata,
                        result.videoPath,
                        result.thumbnailPath
                    );
                } catch(error) {
                    console.error(`[DownloadManager] Failed to save to DB:`, error);
                }

                this.updateJobStatus(job.id, 'completed', 100);
            }
        } catch(error) {
            console.error(`[DownloadManager] Job failed: ${job.id}`, error);
            this.updateJobStatus(job.id, 'failed');
        }

        this.notifyQueueUpdate();

        const delay = calculateJobDelay(job.url);

        setTimeout(() => {
            this.processQueue();
        }, delay);
    }

    private updateJobStatus(id: string, status: DownloadJob['status'], progress?: number) {
        const index = this.queue.findIndex(j => j.id === id);
        if(index === -1) return;

        this.queue[index].status = status;
        if(progress !== undefined) this.queue[index].progress = progress;

        this.notifyQueueUpdate();

        try {
            db.update(downloadQueue)
                .set({
                    status: status,
                    progress: progress || this.queue[index].progress,
                    updatedAt: new Date()
                })
                .where(eq(downloadQueue.id, id))
                .run();
        } catch(error) {
            console.error('[DownloadManager] DB Update Failed:', error);
        }
    }

    private notifyQueueUpdate() {
        if(this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('download:queue-update', this.queue);
        }
    }

    public removeJob(jobId: string) {
        this.queue = this.queue.filter(j => j.id !== jobId);
        try {
            db.delete(downloadQueue).where(eq(downloadQueue.id, jobId)).run();
        } catch(error) {
            console.error('[DownloadManager] Failed to delete job from DB:', error);
        }
        this.notifyQueueUpdate();
    }

    public clearQueue() {
        this.queue = this.queue.filter(j => j.status === 'downloading');
        this.notifyQueueUpdate();
    }
}