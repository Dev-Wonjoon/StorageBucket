from pathlib import Path
import instaloader, re, shutil, uuid
from typing import Callable, Dict
from src.core.config import Config
from src.workers.base_downloader import BaseDownloader

class InstagramDownloader(BaseDownloader):
    """instaloader를 사용하여 게시물을 다운로드하는 클래스입니다."""

    def __call__(self) -> Dict:
        base_download_path = Config.download_dir() / self.source
        temp_dir = None
        try:
            L = instaloader.Instaloader(
                dirname_pattern=str(base_download_path / "{profile}"),
                filename_pattern="{date_utc:%Y-%m-%d}_{shortcode}",
                download_pictures=True,
                download_videos=True,
                download_video_thumbnails=False,
                download_geotags=False,
                download_comments=False,
                save_metadata=False,
                quiet=True
            )

            match = re.search(r"/(?:p|reel|reels|tv)/([^/]+)", self.url)
            if not match:
                raise ValueError("유효한 인스타그램 게시물이 아닙니다.")

            shortcode = match.group(1)
            post = instaloader.Post.from_shortcode(L.context, shortcode)

            target_dir = base_download_path / post.owner_username
            temp_dir = target_dir / f"temp_{uuid.uuid4().hex[:8]}"
            temp_dir.mkdir(parents=True, exist_ok=True)

            L.dirname_pattern = str(temp_dir)

            self.progress_callback({"status": "downloading"})

            L.download_post(post, "")

            new_files = list(temp_dir.iterdir())
            if not new_files:
                raise FileNotFoundError("다운로드된 파일을 임시 폴더에서 찾을 수 없습니다.")

            moved_files = []
            for temp_file in new_files:
                final_path = target_dir / temp_file.name
                shutil.move(temp_file, final_path)
                moved_files.append(final_path)

            thumbnail_path = next((f for f in moved_files if f.suffix in ['.jpg', '.jpeg', '.png']), None)
            self.progress_callback({"status": "finished", "filename": str(moved_files[0])})
            
            metadata = {
                "title": post.caption[:50] if post.caption else shortcode,
                "filepath": str(moved_files[0]),
                "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
                "url": self.url,
                "filesize": None,
                "uploader": post.owner_username,
                "uploader_id": post.owner_id,
            }
            return metadata
        finally:
            if temp_dir and temp_dir.exists():
                shutil.rmtree(temp_dir)