import yt_dlp
from pathlib import Path
from urllib.parse import urlparse
from .base_worker import BaseDownloadWorker
from .data_model import DownloadMediaInfo, FileInfo
from ..core.config import ConfigManager


class YtdlpWorker(BaseDownloadWorker):
    
    def __init__(self, url: str, parent=None):
        super().__init__(url, parent)
        self.config = ConfigManager()
    
    def get_domain_name(self, url: str) -> str:
        parsed = urlparse(url)
        netloc = parsed.netloc
        
        host = netloc.split(":")[0]
        
        parts = host.split(".")
        if len(parts) >= 2:
            return parts[-2]
        return host
    
    def run(self):
        domain = self.get_domain_name(self.url)
        
        try:
            download_path = Path(self.config.get_download_directory() / domain)
            download_path.mkdir(parent=True, exist_ok=True)
            
            ydl_opts = {
                'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                'outtmpl': str(download_path / "%(title)s_%(id)s.%(ext)s"),
                'quiet': True,
                'noplaylist': True
            }
            
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(self.url, download=True)
                
                filename = ydl.prepare_filename(info)
                filepath = str(Path(filename))
            
            file_info = FileInfo(
                filepath=filepath,
                filename=Path(filepath).name,
                filesize=Path(filepath).stat().st_size if Path(filepath).exists() else None,
            )
            
            media_info = DownloadMediaInfo(
                files=[FileInfo],
                source_url=self.url,
                title=info.get("title"),
                thumbnail_url=info.get("thumbnail"),
                platform_name=domain,
                uploader=info.get("uploader"),
                upload_date=info.get("upload_date"),
            )
            
            self.finished.emit(media_info)
        except Exception as e:
            self.error.emit(str(e))