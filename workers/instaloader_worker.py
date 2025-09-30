# Deprecated

import instaloader, logging, requests
from pathlib import Path
from PySide6.QtCore import Slot
from urllib.parse import urlparse
from uuid import uuid4
from .base_worker import BaseDownloadWorker
from .data_model import DownloadMediaInfo, FileInfo
from core.config import ConfigManager


class InstaloaderWorker(BaseDownloadWorker):
    def __init__(self, url: str):
        super().__init__(url)
        self.config = ConfigManager()
    
    @Slot()
    def run(self):
        try:
            base_dir = Path(self.config.get_download_directory()) / "instagram"
            loader = instaloader.Instaloader(
                download_comments=False,
                save_metadata=False,
                compress_json=False,
                dirname_pattern=str(base_dir / "{owner_id}"),
                filename_pattern="{shortcode}",
                post_metadata_txt_pattern="",
                quiet=True,
            )
            
            post = self._fetch_post_info(loader, self.url)
            target_dir = base_dir / str(post.owner_id)
            
            media_files, thumbnail_path = self._download_contents(loader, post, target_dir)
            
            media_info = self._build_media_info(post, media_files, thumbnail_path)
            
            self.success.emit(media_info)
            
        except Exception as e:
            logging.error("[InstaloaderWorker] 실행 중 오류 발생", exc_info=True)
            self.failed.emit(str(e))
        finally:
            self.finished.emit()
    
    def _fetch_post_info(self, loader: instaloader.Instaloader, url: str) -> instaloader.Post:
        shortcode = self._extract_shortcode(url)
        if not shortcode:
            raise ValueError(f"Instagram URL에서 shortcode를 추출할 수 없습니다: {url}")
        logging.info(f"'{shortcode}' 포스트 정보를 가져옵니다.")
        return instaloader.Post.from_shortcode(loader.context, shortcode)
    
    def _download_contents(self, loader: instaloader.Instaloader, post: instaloader.Post, target_dir: Path) -> tuple[list[Path], str | None]:
        thumbnail_path = None
        if post.is_video:
            logging.info("동영상 감지")
            thumbnail_path = self._download_thumbnail(post.url, f"{post.shortcode}_thumb")

        logging.info(f"'{post.shortcode}' 미디어 다운로드를 시작합니다...")
        loader.download_post(post, "")
        
        renamed_media_files = []
        file_counter = 1
        
        for file in sorted(target_dir.glob(f"{post.shortcode}*")):
            if file.suffix.lower() in ['.jpg', '.jpeg', '.png', '.mp4'] and '_thumbnail' not in file.name:
                upload_date = post.date_local.strftime("%Y%m%d")
                unique_id = post.shortcode
                owner_username = post.owner_username
                extension = file.suffix
                
                new_filename = f"{upload_date}_{unique_id}_{owner_username}_{file_counter}{extension}"
                new_path = file.parent / new_filename
                
                file.rename(new_path)
                renamed_media_files.append(new_path)
                file_counter += 1
        if not thumbnail_path and renamed_media_files:
            for file in renamed_media_files:
                if file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                    thumbnail_path = str(file)
                    break
        if not renamed_media_files:
            raise FileNotFoundError("다운로드된 미디어 파일을 찾을 수 없습니다.")
        return renamed_media_files, thumbnail_path
        
    def _build_media_info(self, post: instaloader.Post, media_files: list[Path], thumbnail_path: str | None) -> DownloadMediaInfo:
        files = []
        for filepath in media_files:
            files.append(
                FileInfo(
                    filepath=str(filepath),
                    filename=filepath.name,
                    filesize=filepath.stat().st_size,
                    thumbnail_url=thumbnail_path
                )
            )
        return DownloadMediaInfo(
            files=files,
            source_url=self.url,
            title=post.caption or post.shortcode,
            platform_name="instagram",
            uploader=post.owner_username,
            upload_date=post.date_local.strftime("%Y%m%d"),
        )
    
    def _extract_shortcode(self, url: str) -> str | None:
        try:
            parts = url.strip("/").split("/")
            for key in ("p", "reel", "reels", "tv"):
                if key in parts:
                    return parts[parts.index(key) + 1]
            return None
        except Exception:
            return None
    
    def _download_thumbnail(self, url: str, file_prefix: str) -> str | None:
        if not url or not file_prefix:
            return None
        try:
            thumb_dir = Path(self.config.get_thumbnail_directory()) / "instagram"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            extension = Path(urlparse(url).path).suffix or ".jpg"
            filepath = thumb_dir / f"{file_prefix}{extension}"
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