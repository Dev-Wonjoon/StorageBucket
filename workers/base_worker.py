from PySide6.QtCore import QRunnable, QObject, Signal, Slot
from .data_model import DownloadMediaInfo


class BaseDownloadWorker(QRunnable, QObject):
    success = Signal(DownloadMediaInfo)
    failed = Signal(str)
    finished = Signal()
    
    def __init__(self, url: str):
        super().__init__()
        QObject.__init__(self)
        self.url = url
    
    @Slot()
    def run(self):
        try:
            raise NotImplementedError("run 메서드는 반드시 구현 되어야 합니다.")
        except Exception as e:
            self.failed.emit(str(e))
        finally:
            self.finished.emit()
    