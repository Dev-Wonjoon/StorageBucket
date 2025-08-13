from PySide6.QtCore import QObject, QThread, Signal
from typing import Optional, Dict
from uuid import uuid4
from urllib.parse import urlparse
import re, logging

from src.services.thread_manager import Task, thread_manager
from src.workers.instaloader_downloader import InstagramDownloader
from src.workers.ytdlp_downloader import YtdlpDownloader

class DownloadTask:
    def __init__(self, task_id: str, url: str, source: str):
        self.id = task_id
        self.url = url
        self.source = source


class DownloadManager(QObject):
    task_progress = Signal(str, dict)
    task_error = Signal(str, str)
    task_finished = Signal(str, int)
    download_successed = Signal(str, dict)

    def __init__(self, parent: Optional[QObject] = None):
        super().__init__(parent)
        self._tasks: Dict[str, DownloadTask] = {}

    def _get_downloader_class(self, url: str):
        if re.search(r"instagram\.com", url):
            return InstagramDownloader
        else:
            return YtdlpDownloader

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

    def start_download(self, url: str) -> Optional[DownloadTask]:
        task_id = uuid4().hex[:12]
        source = self._get_source_from_url(url)
        task_info = DownloadTask(task_id, url, source)
        self._tasks[task_id] = task_info
        
        def on_download_success(metadata: dict):
            self.task_finished.emit(task_id, 0)
            self.download_successed.emit(task_id, metadata)
            self._tasks.pop(task_id, None)
        
        def on_download_error(error_msg: str):
            self.task_error.emit(task_id, error_msg)
            self.task_finished.emit(task_id, 1)
            self._tasks.pop(task_id, None)
        
        def on_progress(progress_data: dict):
            self.task_progress.emit (task_id, progress_data)
        
        DownloaderClass = self._get_downloader_class(url)
        downloader_instance = DownloaderClass(url, source, on_progress)
        download_task = Task(
            target=downloader_instance,
            on_success=on_download_success,
            on_error=on_download_error
        )
        thread_manager.submit(download_task)

        return task_info


    def cancel_task(self):
        logging.info("작업 취소는 현재 지원되지 않습니다.")

    def cancel_all_tasks(self, task_id: str):
        logging.info(f"'{task_id}' 작업 취소는 현재 지원되지 않습니다.")
        return False
    