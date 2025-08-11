from PySide6.QtCore import QObject, QThread, Signal
from typing import Optional
from uuid import uuid4
import yt_dlp

from src.core.config import Config


class YtdlpDownloadThread(QThread):
    progress = Signal(dict)
    error = Signal(str)
    finished = Signal(int)
    
    def __init__(self, url: str, opts: dict, parent=None):
        super().__init__(parent)
        self.url = url
        self.opts = opts
        self.opts["progress_hooks"] = [self._progress_hook]
        self.opts["quiet"] = True
        self.opts["no_warnings"] = True
    
    def run(self):
        try:
            with yt_dlp.YoutubeDL(self.opts) as ydl:
                retcode = ydl.download([self.url])
            self.finished.emit(retcode)
        except Exception as e:
            self.error.emit(str(e))
    
    def _progress_hook(self, d):
        self.progress.emit(d)
    

class YtdlpDownloader(QObject):
    progress = Signal(dict)
    error = Signal(str)
    finished = Signal(int)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._thread: Optional[YtdlpDownloadThread] = None
        
    
    
    def start(self, url: str, *, source: str = "Unknown", **kwargs):
        if self._thread and self._thread.isRunning():
            return

        download_path = Config.download_dir()
        source_path = download_path / source
        source_path.mkdir(parents=True, exist_ok=True)
        uid = uuid4().hex[:8]
        output_template = source_path / f"%(title)s_{uid}.%(ext)s"
        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "outtmpl": str(output_template)
        }
        
        self._thread = YtdlpDownloadThread(url, ydl_opts, self)
        self._thread.progress.connect(self.progress)
        self._thread.error.connect(self.error)
        self._thread.finished.connect(self.finished)
        self._thread.start()
    
    def kill(self):
        if self._thread and self._thread.isRunning():
            self._thread.terminate()
            self._thread.wait()