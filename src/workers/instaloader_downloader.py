from pathlib import Path
from PySide6.QtCore import QObject, QThread, Signal
from typing import Optional
from uuid import uuid4
import instaloader, re, shutil
from src.core.config import Config

class InstagramDownloadThread(QThread):
    progress = Signal(dict)
    error = Signal(str)
    finished = Signal(int)
    metadata_ready = Signal(dict)

    def __init__(self, url: str, base_path: Path, parent=None):
        super().__init__(parent)
        self.url = url
        self.download_path = base_path
        self.daemon = True

    def run(self):
        temp_dir: Path = None
        try:
            L = instaloader.Instaloader(
                filename_pattern="{date:%Y-%m-%d}_{shortcode}",
                download_pictures=True,
                download_videos=True,
                download_video_thumbnails=False,
                download_geotags=False,
                download_comments=False,
                save_metadata=False
            )

            match = re.search(r"/(?:p|reel|reels|tv)/([^/]+)", self.url)
            if not match:
                self.error.emit("유효한 인스타그램 게시물이 아닙니다.")
                self.finished.emit(1)
                return
            
            shortcode = match.group(1)
            post = instaloader.Post.from_shortcode(L.context, shortcode)
            target_dir = self.download_path / post.owner_id
            temp_dir = target_dir / f"temp_{uuid4().hex[:8]}"
            temp_dir.mkdir(parents=True, exist_ok=True)
            L.dirname_pattern = str(temp_dir)
            
            
            self.progress.emit({"status": "downloading"})
            L.download_post(post, "")
            
            new_files = list(temp_dir.iterdir())
            if not new_files:
                raise FileNotFoundError("다운로드된 파일을 찾을 수 없습니다.")
            
            moved_files = []
            for temp_file in new_files:
                final_path = target_dir / temp_file.name
                shutil.move(temp_file, final_path)
                moved_files.append(final_path)

            thumbnail_path = next((f for f in moved_files if f.suffix in ['.jpg', '.jpeg', '.png']), None)
            
            metadata = {
                "title": post.caption[:50] if post.caption else post.shortcode,
                "filename": str(moved_files[0]),
                "thumbnail_path": thumbnail_path,
                "url": self.url,
                "filesize": None,
                "platform": "instagram",
                "uploader": post.owner_username,
                "uploader_id": post.owner_id,
            }
            self.metadata_ready.emit(metadata)
            self.finished.emit(0)
        except instaloader.exceptions.InstaloaderException as e:
            self.error.emit(f"다운로드 실패: {e}")
            self.finished.emit(1)
        finally:
            if temp_dir and temp_dir.exists():
                shutil.rmtree(temp_dir)

class InstagramDownloader(QObject):
    progress = Signal(dict)
    finished = Signal(int)
    error = Signal(str)
    metadata_ready = Signal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._thread: Optional[InstagramDownloadThread] = None

    def start(self, url: str, **kwargs):
        if self._thread and self._thread.isRunning():
            return
        
        download_path = Config.download_dir()
        source_path = download_path / "Instagram"
        source_path.mkdir(parents=True, exist_ok=True)

        self._thread = InstagramDownloadThread(url, source_path, self)
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