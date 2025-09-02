import instaloader
from pathlib import Path
from uuid import uuid4
from .base_worker import BaseDownloadWorker
from .data_model import DownloadMediaInfo, FileInfo
from core.config import ConfigManager


class InstaloaderWorker(BaseDownloadWorker):
    def __init__(self, url: str, parent=None):
        super().__init__(url, parent)
        self.config = ConfigManager()
    
    def run(self):
        try:
            shortcode = self._extract_shortcode(self.url)
            if not shortcode:
                raise ValueError(f"Instagram URL에서 shortcode를 추출 할 수 없습니다: {self.url}")
            loader = instaloader.Instaloader(
                download_comments=False,
                save_metadata=False,
                compress_json=False,
                post_metadata_txt_pattern="",
            )
            
            post = instaloader.Post.from_shortcode(loader.context, shortcode)
            
            owner_id = str(post.owner_id)
            base_dir = Path(self.config.get_download_directory()) / "instagram" / owner_id
            base_dir.mkdir(parents=True, exist_ok=True)
            
            loader.dirname_pattern = str(base_dir)
            loader.filename_pattern = "{shortcode}"
            
            loader.download_post(post, target=base_dir)
            
            files: list[FileInfo] = []
            for file in base_dir.glob(f"{shortcode}*"):
                if file.is_file():
                    unique_id = uuid4().hex[:8]
                    new_name = f"{shortcode}_{unique_id}{file.suffix}"
                    new_path = file.parent / new_name
                    
                    file.rename(new_path)
                    
                    files.append(
                        FileInfo(
                            filepath=str(new_path),
                            filename=new_name,
                            filesize=new_path.stat().st_size,
                            thumbnail_url=post.url,
                        )
                    )
            media_info = DownloadMediaInfo(
                files=files,
                source_url=self.url,
                title=post.title or shortcode,
                platform_name="instagram",
                uploader=post.owner_username,
                upload_date=post.date_local.strftime("%Y%m%d_%H%M%S"),
            )
            
            self.success.emit(media_info)
        except Exception as e:
            self.failed.emit(str(e))
    
    def _extract_shortcode(self, url: str) -> str | None:
        try:
            parts = url.strip("/").split("/")
            
            for key in ("p", "reel", "reels", "tv"):
                if key in parts:
                    idx = parts.index(key)
                    return parts[idx + 1]
            
            if "stories" in parts:
                idx = parts.index("stories")
                if len(parts) > idx + 2:
                    return parts[idx + 2]
            
            return None
        except Exception:
            return None