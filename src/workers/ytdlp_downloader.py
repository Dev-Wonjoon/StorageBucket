from pathlib import Path
from PySide6.QtCore import QObject, QThread, Signal
from typing import Optional
from uuid import uuid4
import yt_dlp

from src.core.config import Config


class YtdlpDownloadThread(QThread):
    progress = Signal(dict)
    error = Signal(str)
    finished = Signal(int)
    metadata_ready = Signal(dict)

    def __init__(self, url: str, opts: dict, parent=None):
        super().__init__(parent)
        self.url = url
        self.opts = opts
        self.opts["progress_hooks"] = [self._progress_hook]
        self.opts["quiet"] = True
        self.opts["no_warnings"] = True
        self.daemon = True

    def run(self):
        try:
            with yt_dlp.YoutubeDL(self.opts) as ydl:
                info_dict = ydl.extract_info(self.url, download=True)
                filepath = Path(ydl.prepare_filename(info_dict))
                thumbnail_path = filepath.with_suffix(".jpg")
                if not thumbnail_path.exists():
                    thumbnail_path = filepath.with_suffix(".webp")
                metadata = {
                    "title": info_dict.get("title"),
                    "filename": filepath,
                    "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
                    "url": info_dict.get("webpage_url"),
                    "filesize": info_dict.get("filesize") or info_dict.get("filesize_approx"),
                    "platform": info_dict.get("extractor_key"),
                    "uploader": info_dict.get("uploader"),
                    "uploader_id": info_dict.get("uploader_id"),
                }
                self.metadata_ready.emit(metadata)
            self.finished.emit(0)
        except Exception as e:
            self.error.emit(str(e))
            self.finished.emit(1)

    def _progress_hook(self, d):
        self.progress.emit(d)


class YtdlpDownloader(QObject):
    progress = Signal(dict)
    error = Signal(str)
    finished = Signal(int)
    metadata_ready = Signal(dict)

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
            "outtmpl": str(output_template),
            "merge_output_format": "mp4",
            "writethumbnail": True,
        }

        self._thread = YtdlpDownloadThread(url, ydl_opts, self)
        self._thread.progress.connect(self.progress)
        self._thread.error.connect(self.error)
        self._thread.finished.connect(self.finished)
        self._thread.metadata_ready.connect(self.metadata_ready)
        self._thread.finished.connect(self._thread.deleteLater)
        self._thread.start()

    def kill(self):
        if self._thread and self._thread.isRunning():
            self._thread.terminate()
            self._thread.wait()