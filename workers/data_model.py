from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional, List
from PySide6.QtCore import QObject, Signal

class DownloadStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"

class DownloadTask(QObject):
    progress_changed = Signal(int)
    status_changed = Signal(str)
    finished = Signal()
    failed = Signal(str)

    def __init__(self, url: str, title: str = "", parent: QObject | None = None):
        super().__init__(parent)
        self.url = url
        self.title = title
        self._progress = 0
        self._status = DownloadStatus.PENDING
    
    @property
    def progress(self) -> int:
        return self._progress

    @progress.setter
    def status(self, value: int):
        if self._progress != value:
            self._progress = value
            self.progress_changed.emit(value)
    
    @property
    def status(self) -> str:
        return self._status
    
    @status.setter
    def status(self, value: str | DownloadStatus):
        if isinstance(value, DownloadStatus):
            value = value.value
        if self._status != value:
            self._status = value
            self.status_changed.emit(value)
            
            if value == DownloadStatus.SUCCESS.value:
                self.finished.emit()
            elif value == DownloadStatus.FAILED.value:
                self.failed.emit("다운로드 실패")

@dataclass
class FileInfo:
    filepath: str
    filename: str
    filesize: Optional[int] = None
    thumbnail_url: Optional[str] = None
    
    
@dataclass
class DownloadMediaInfo:
    files: List[FileInfo]
    source_url: str
    title: Optional[str] = None
    platform_name: Optional[str] = None
    uploader: Optional[str] = None
    upload_date: Optional[str] = None

