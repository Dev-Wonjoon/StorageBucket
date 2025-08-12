from PySide6.QtCore import QObject, QThread, Signal
from typing import Optional, Dict
from uuid import uuid4
from urllib.parse import urlparse
import re
from src.workers.instalodaer_downloader import InstagramDownloader
from src.workers.ytdlp_downloader import YtdlpDownloader
from src.database.repository import DatabaseWriteWorker

class DownloadTask:
    def __init__(self, task_id: str, url: str, source: str):
        self.id = task_id
        self.url = url
        self.source = source


class DownloadManager(QObject):
    task_progress = Signal(str, dict)
    task_error = Signal(str, str)
    task_finished = Signal(str, int)
    task_saved = Signal(str)

    def __init__(self, parent: Optional[QObject] = None):
        super().__init__(parent)
        self._tasks: Dict[str, DownloadTask] = {}
        self._workers: Dict[str, QThread] = {}
        self._db_workers: Dict[str, DatabaseWriteWorker] = {}

    def _get_downloader(self, url: str) -> Optional[QObject]:
        if re.search(r"instagram\.com", url):
            return InstagramDownloader()
        else:
            return YtdlpDownloader()

    def _get_source_from_url(self, url: str) -> str:
        try:
            netloc = urlparse(url).netloc.lower()
            if not netloc:
                return "unknown"
            parts = netloc.split('.')
            if len(parts) > 2 and len(parts[-2]) <= 3 and len(parts[-1]) <= 3:
                domain_name = parts[-3]
            elif len(parts) > 1:
                domain_name = parts[-2]
            else:
                domain_name = parts[0]
            return domain_name if domain_name else "unknown"
        except Exception:
            return "unknown"

    def create_task(self, url: str) -> Optional[DownloadTask]:
        downloader = self._get_downloader(url)
        if not downloader:
            return None
        task_id = uuid4().hex[:12]
        if isinstance(downloader, InstagramDownloader):
            source = "Instagram"
        else:
            source = self._get_source_from_url(url)
        task = DownloadTask(task_id, url, source)

        self._tasks[task_id] = task
        self._workers[task_id] = downloader

        downloader.progress.connect(lambda p, tid=task_id: self.task_progress.emit(tid, p))
        downloader.error.connect(lambda e, tid=task_id: self.task_error.emit(tid, e))
        downloader.finished.connect(lambda c, tid=task_id: self._on_task_finished(tid, c))
        downloader.metadata_ready.connect(lambda m, tid=task_id: self._on_metadata_ready(tid, m))

        return task

    def start_task(self, task_id: str):
        if task_id in self._workers:
            task = self._tasks[task_id]
            worker = self._workers[task_id]
            worker.start(task.url)

    def cancel_task(self, task_id: str) -> bool:
        if task_id in self._workers:
            self._workers[task_id].kill()
            return True
        if task_id in self._db_workers:
            # DB worker cannot be killed, just remove it
            self._db_workers.pop(task_id, None)
            return True
        return False

    def cancel_all_tasks(self):
        for worker in self._workers.values():
            worker.kill()
        self._db_workers.clear()


    def _on_metadata_ready(self, task_id: str, metadata: dict):
        """Save metadata to the database in a separate thread."""
        media_data = {
            "title": metadata.get("title"),
            "filepath": str(metadata.get("filename")),
            "url": metadata.get("url"),
            "file_size": metadata.get("filesize"),
            "platform": metadata.get("platform"),
            "uploader": metadata.get("uploader"),
            "uploader_id": metadata.get("uploader_id"),
            "tags": metadata.get("tags")
        }
        
        db_worker = DatabaseWriteWorker(media_data)
        db_worker.finished.connect(lambda tid=task_id: self._on_db_write_finished(tid))
        db_worker.error.connect(lambda e, tid=task_id: self.task_error.emit(tid, e))
        self._db_workers[task_id] = db_worker
        db_worker.start()

    def _on_db_write_finished(self, task_id: str):
        self.task_saved.emit(task_id)
        self._db_workers.pop(task_id, None)

    def _on_task_finished(self, task_id: str, exit_code: int):
        self.task_finished.emit(task_id, exit_code)
        self._workers.pop(task_id, None)
        if exit_code != 0: # If download fails, remove task
             self._tasks.pop(task_id, None)