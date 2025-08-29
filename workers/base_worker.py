from PySide6.QtCore import QThread, Signal
from .data_model import DownloadMediaInfo


class BaseDownloadWorker(QThread):
    finished = Signal(DownloadMediaInfo)
    error = Signal(str)
    
    def __init__(self, url: str, parent=None):
        super().__init__(parent)
        self.url = url
        
    def run(self):
        "이 메서드는 반드시 재정의되어야 합니다."
        raise NotImplementedError
    