import yt_dlp, requests, logging
from pathlib import Path
from urllib.parse import urlparse
from .base_worker import BaseDownloadWorker
from .data_model import DownloadMediaInfo, FileInfo
from core.config import ConfigManager


class YtdlpWorker(BaseDownloadWorker):
    
    def __init__(self, url: str, parent=None):
        super().__init__(url, parent)
        self.config = ConfigManager()
    
    def run(self):
        try:
            domain = self._get_domain_name(self.url)
            download_dir = Path(self.config.get_download_directory()) / domain
            download_dir.mkdir(parents=True, exist_ok=True)
            ydl_ops = self._get_ydl_opts(download_dir)
            
            logging.info(f"[Worker] yt-dlp 인스턴스 실행 중...")
            with yt_dlp.YoutubeDL(ydl_ops) as ydl:
                logging.info(f"[Worker] extract_info 호출 시작")
                info = ydl.extract_info(self.url, download=True)
                media_info = self._process_download_info(info, domain, ydl)
                
            logging.info(f"[Worker] success 발행")
            self.success.emit(media_info)
        except Exception as e:
            logging.error("[Worker] 실행 중 심각한 오류 발생", exc_info=True)
            self.failed.emit(str(e))
    
    def _get_ydl_opts(self, download_path: Path) -> dict:
        outout_template = download_path / "%(title)s_%(id)s.%(ext)s"
        return {
            'format': 'bestvideo/bestaudio/best',
            'outtmpl': str(outout_template),
            'quiet': True,
            'noplaylist': True,
            'merge_output_format': 'mp4',
        }
    
    def _get_domain_name(self, url: str) -> str:
        parsed = urlparse(url)
        netloc = parsed.netloc
        
        host = netloc.split(":")[0]
        
        parts = host.split(".")
        if len(parts) >= 2:
            return parts[-2]
        return host
    
    def _download_thumbnail(self, url: str, video_id: str) -> str | None:
        if not url:
            return None
        try:
            thumb_dir = Path(self.config.get_thumbnail_directory())
            thumb_dir.mkdir(parents=True, exist_ok=True)
            
            extension = Path(urlparse(url).path).suffix or '.jpg'
            filepath = thumb_dir / f"{video_id}{extension}"
            
            response = requests.get(url, stream=True)
            response.raise_for_status()
            
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return str(filepath)
        except requests.exceptions.RequestException as e:
            return None
    
    def _process_download_info(self, info: dict, domain: str, ydl: yt_dlp.YoutubeDL) -> DownloadMediaInfo:
        files = []
        entries = info.get("entries") or [info]
        
        for entry in entries:
            if entry:
                files.append(self._create_file_info_from_entry(entry, ydl))
        
        return DownloadMediaInfo(
            files=files,
            source_url=self.url,
            title=info.get("title"),
            platform_name=domain,
            uploader=info.get("uploader"),
            upload_date=info.get("upload_date"),
        )
    
    def _create_file_info_from_entry(self, entry: dict, ydl: yt_dlp.YoutubeDL) -> FileInfo:
        thumbnail_path = self._download_thumbnail(
            url=entry.get("thumbnail"),
            video_id=entry.get("id")
        )
        
        filepath_str = ydl.prepare_filename(entry)
        if not filepath_str:
            logging.error(f"yt-dlp가 파일 경로를 생성하지 못했습니다. Entry: {entry}")
            return None
        
        filepath = Path(filepath_str)
        
        return FileInfo(
            filepath=str(filepath),
            filename=filepath.name,
            filesize=filepath.stat().st_size if filepath.exists() else 0,
            thumbnail_url=thumbnail_path
        )
    
    def _download_thumbnail(self, url: str, video_id: str) -> str | None:
        if not url or not video_id:
            return None
        try:
            thumb_dir = Path(self.config.get_thumbnail_directory())
            thumb_dir.mkdir(parents=True, exist_ok=True)
            
            extension = Path(urlparse(url).path).suffix or '.jpg'
            filepath = thumb_dir / f"{video_id}{extension}"
            
            if filepath.exists():
                return str(filepath)
            
            response = requests.get(url, stream=True, timeout=10)
            response.raise_for_status()
            
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            return str(filepath)
        except requests.exceptions.RequestException as e:
            logging.error(f"썸네일 다운로드 실패: {url}, 오류: {e}")
            return None