import logging, requests
from pathlib import Path
from PySide6.QtCore import QObject, Signal, Slot
from urllib.parse import urlparse
from uuid import uuid4
from core.config import ConfigManager
from screens.main_window.model import MediaItem
from database.repository.media_repository import MediaRepository
from database.repository.tag_repository import TagRepository
from database.repository.platform_repository import PlatformRepository
from database.models.media import Media
from database.models.platform import Platform
from screens.main_window.model import MediaItem
from workers.ytdlp_worker import YtdlpWorker
from workers.data_model import DownloadMediaInfo

logger = logging.getLogger(__name__)

class MediaService(QObject):
    media_added = Signal(list)
    error_occurred = Signal(str)
    
    def __init__(self, media_repo: MediaRepository, tag_repo: TagRepository, platform_repo: PlatformRepository, config: ConfigManager):
        super().__init__()
        self.media_repo = media_repo
        self.tag_repo = tag_repo
        self.platform_repo = platform_repo
        self.config = config
        self.download_worker = None
        self._all_media_items_cache = []
    
    def get_initial_media_items(self) -> list[MediaItem]:
        self._all_media_items_cache = self.media_repo.get_all_as_media_items()
        return self._all_media_items_cache
    
    def get_available_tags(self) -> list[str]:
        all_tags = self.tag_repo.get_all()
        return ['All'] + [tag.name for tag in all_tags]
    
    def filter_media_by_tag(self, tag_name: str) -> list[MediaItem]:
        if tag_name == "All":
            return self._all_media_items_cache
        return [
            item for item in self._all_media_items_cache if tag_name in item.tags
        ]
    
    @Slot(str)
    def add_media_from_local(self, filepath: str):
        logger.info(f"[MediaService] 로컬 저장 시도: {filepath}")
        try:
            new_media = self.media_repo.create(
                Media(title=filepath.split('/')[-1], filepath=filepath)
            )
            
            ui_item = MediaItem(
                id=new_media.id,
                title=new_media.title,
                filepath=new_media.filepath,
                thumbnail_path=new_media.thumbnail_path,
                profile_name=None,
                tags=[]
            )
            self.media_added.emit([ui_item])
        except Exception as e:
            self.error_occurred.emit(f"파일추가 실패: {e}")
    
    @Slot(str)
    def download_media(self, url: str):
        logger.info(f"[MediaService] 다운로드 시작: {url}")
        try:
            self.download_worker = YtdlpWorker(url)
            self.download_worker.success.connect(self._on_download_success)
            self.download_worker.failed.connect(self._on_download_failed)
            self.download_worker.run()
            logger.info(f"[MediaService] YtdlpWorker 실행됨")
        except Exception as e:
            logger.exception(f"[MediaService] 다운로드 실패: {e}")
            self.error_occurred.emit(f"다운로드 실패: {e}")
    
    def _on_download_success(self, media_info: DownloadMediaInfo):
        logger.info(f"[MediaService] DB에 저장 시도: {media_info.source_url}")
        platform = self._get_platform_from_url(media_info.source_url)
        added_items: list[MediaItem] = []
            
        try:
            for file_info in media_info.files:
                local_thumbnail = self._save_thumbnail(file_info.thumbnail_url, platform.name)
                
                media = Media(
                    title=media_info.title or Path(file_info.filename).stem,
                    filepath=file_info.filepath,
                    url=media_info.source_url,
                    thumbnail_path=local_thumbnail,
                    filesize=file_info.filesize,
                    platform_id=platform.id
                )
                
                ui_item = self.media_repo.create_and_get_item(media)
                added_items.append(ui_item)
        except Exception as e:
                logger.exception("[MediaService] DB 저장 실패")
                self.error_occurred.emit(f"DB 저장 실패: {e}")
        if added_items:
            self.media_added.emit(added_items)
    
    def _on_download_failed(self, message: str):
        self.error_occurred.emit(f"다운로드 실패: {message}")
    
    
    def _extract_domain(self, url: str) -> str:
        parsed = urlparse(url)
        host = parsed.netloc.split(":")[0]
        parts = host.split(".")
        if len(parts) >= 2:
            return parts[-2].lower()
        return host.lower()
    
    def _get_platform_from_url(self, url: str) -> Platform:
        domain = self._extract_domain(url)
        platform = self.platform_repo.get_or_create(domain)
        return platform

    def _save_thumbnail(self, url: str, platform_name: str) -> str | None:
        if not url:
            return None
        try:
            base_dir = Path(self.config.get_download_directory() / "thumbnails" / platform_name)
            base_dir.mkdir(parents=True, exist_ok=True)
            
            ext = Path(url).suffix or ".jpg"
            filename = f"{uuid4().hex}{ext}"
            filepath = base_dir / filename
            
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            with open(filepath, "wb") as f:
                f.write(response.content)
            
            return str(filepath)
        except Exception as e:
            self.error_occurred.emit(f"썸네일 저장 실패: {e}")
            return None