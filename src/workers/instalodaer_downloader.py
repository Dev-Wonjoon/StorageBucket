from pathlib import Path
from PySide6.QtCore import QObject, QThread, Signal
from typing import Optional
import instaloader, re

class InstagramDownloadThread(QThread):
    progress = Signal(dict)
    error = Signal(str)
    finished = Signal(int)
    
    def __init__(self, url: str, base_path: Path, parent=None):
        super().__init__(parent)
        self.url = url
        self.download_path = base_path
    
    def run(self):
        try:
            L = instaloader.Instaloader(
                dirname_pattern=str(self.download_path / "{profile}"),
                filename_pattern="{date:%Y-%m-%d}",
                download_pictures=True,
                download_videos=True,
                download_video_thumbnails=False,
                download_geotags=False,
                download_comments=False,
                save_metadata=False
            )
            
            match = re.search(r"(p|reel|tv)/([^/]+)", self.url)
            if not match:
                self.error.emit("유효한 인스타그램 게시물이 아닙니다.")
                self.finished.emit(1)
                return
            shortcode = match.group(2)
            post = instaloader.Post.from_shortcode(L.context, shortcode)
            plausible_filename = self.download_path / post.owner_id / f"{post.date.strftime('%Y-%m-%d')}_{post.owner_username}.jpg"
            self.progress.emit({"status": "downloading"})
            L.download_post(post, target=post.owner_id)
            
            self.progress.emit({
                "status": "finished",
                "filename": str(plausible_filename)
            })
            self.finished.emit(0)
        except Exception as e:
            self.error.emit(str(1))

class InstagramDownloader(QObject):
    progress = Signal(dict)
    finished = Signal(int)
    error = Signal(str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._thread: Optional[InstagramDownloadThread] = None
        
    def start(self, url: str, **kwargs):
        if self._thread and self._thread.isRunning():
            return
        insta_opts = {}
        
        self._thread = InstagramDownloadThread(url, insta_opts, self)
        self._thread.progress.connect(self.progress)
        self._thread.error.connect(self.error)
        self._thread.finished.connect(self.finished)
        self._thread.start()
    
    def kill(self):
        if self._thread and self._thread.isRunning():
            self._thread.terminate()
            self._thread.wait()