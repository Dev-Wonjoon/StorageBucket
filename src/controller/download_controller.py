from PySide6.QtCore import QObject, Signal, Slot
from typing import Optional, Dict
from uuid import uuid4
from src.services.download_manager import DownloadManager, DownloadTask


class DownloadController(QObject):
    task_added = Signal(DownloadTask)
    task_progress = Signal(str, dict)
    task_error = Signal(str, str)
    task_finished = Signal(str, int)
    task_saved = Signal(str)

    def __init__(self, parent: Optional[QObject] = None):
        super().__init__(parent)
        self._manager = DownloadManager(self)
        self._manager.task_progress.connect(self.task_progress)
        self._manager.task_error.connect(self.task_error)
        self._manager.task_finished.connect(self.task_finished)
        self._manager.task_saved.connect(self.task_saved)

    def start_download(self, url: str) -> Optional[DownloadTask]:
        url = (url or "").strip()
        if not url:
            return None

        task = self._manager.create_task(url)
        if task:
            self.task_added.emit(task)
            self._manager.start_task(task.id)
            return task
        else:
            self.task_error.emit(uuid4().hex[:12], "지원하지 않는 URL입니다.")
            return None

    def cancel_download(self, task_id: str) -> bool:
        return self._manager.cancel_task(task_id)

    def cancel_all_downloads(self):
        self._manager.cancel_all_tasks()