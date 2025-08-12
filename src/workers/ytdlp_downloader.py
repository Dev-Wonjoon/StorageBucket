import yt_dlp
from pathlib import Path
from uuid import uuid4
from typing import Callable, Dict
from src.core.config import Config
from src.workers.base_downloader import BaseDownloader

class YtdlpDownloader(BaseDownloader):
    """yt-dlp를 사용하여 미디어를 다운로드하는 클래스입니다."""
    
    def __call__(self) -> Dict:
        download_path = Config.download_dir()
        source_path = download_path / self.source
        source_path.mkdir(parents=True, exist_ok=True)

        uid = uuid4().hex[:8]
        output_template = source_path / f"%(title).100s.{uid}.%(ext)s"
        
        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "outtmpl": str(output_template),
            "merge_output_format": "mp4",
            "writethumbnail": True,
            "progress_hooks": [self.progress_callback],
            "quiet": True,
            "no_warnings": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(self.url, download=True)
            
            filepath = Path(ydl.prepare_filename(info_dict))
            thumbnail_path = filepath.with_suffix(".jpg")
            if not thumbnail_path.exists():
                 thumbnail_path = filepath.with_suffix(".webp")
            
            metadata = {
                "title": info_dict.get("title"),
                "filepath": str(filepath),
                "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
                "url": info_dict.get("webpage_url"),
                "filesize": info_dict.get("filesize") or info_dict.get("filesize_approx"),
                "uploader": info_dict.get("uploader"),
                "uploader_id": info_dict.get("uploader_id"),
            }
            return metadata