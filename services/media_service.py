import logging
from pathlib import Path
from PySide6.QtCore import QObject, QThreadPool, Signal, Slot
from urllib.parse import urlparse
from core.config import ConfigManager
from screens.main_window.model import MediaItem
from database.repository.media_repository import MediaRepository
from database.repository.tag_repository import TagRepository
from database.repository.platform_repository import PlatformRepository
from database.models.media import Media
from database.models.platform import Platform
from screens.main_window.model import MediaItem
from workers.instaloader_worker import InstaloaderWorker
from workers.ytdlp_worker import YtdlpWorker
from workers.data_model import DownloadMediaInfo, DownloadStatus

logger = logging.getLogger(__name__)

class MediaService(QObject):
    media_added = Signal(list)
    error_occurred = Signal(str)
    task_created = Signal(DownloadStatus)

    def __init__(self, media_repo: MediaRepository, tag_repo: TagRepository, platform_repo: PlatformRepository, config: ConfigManager):
        super().__init__()
        self.media_repo = media_repo
        self.tag_repo = tag_repo
        self.platform_repo = platform_repo
        self.config = config
        self._all_media_items_cache: list[MediaItem] = []
        
    def get_initial_media_items(self) -> list[MediaItem]:
        self._all_media_items_cache = self.media_repo.get_all_as_media_items()
        return self._all_media_items_cache
    
    def get_available_tags(self) -> list[str]:
        all_tags = self.tag_repo.get_all()
        return ['All'] + [tag.name for tag in all_tags]
    
    def filter_media_by_tag(self, tag_name: str) -> list[MediaItem]:
        if tag_name == "All":
            return self._all_media_items_cache
        
    @Slot(str)
    def add_media_from_local(self, filepath: str):
        logger.info(f"[MediaService] 로컬 파일 저장 시도: {filepath}")
        try:
            platform = self.platform_repo.get_or_create("local")
            media = Media(
                title = Path(filepath).stem,
                filepath=filepath,
                thumbnail_path=None,
                platform_id=platform.id
            )
            ui_item = self.media_repo.create_and_get_item(media)
            self._add_items_to_cache_and_emit([ui_item])
        except Exception as e:
            logger.exception(f"로컬 파일 추가 실패: {filepath}")
            self.error_occurred.emit(f"파일 추가 실패: {e}")
    
    @Slot(str)
    def download_media(self, url: str):
        logger.info(f"[MediaService] 다운로드 시작: {url}")
        try:
            task = DownloadStatus(url=url, title="다운로드 준비중")
            task.status = DownloadStatus.PENDING
            self.task_created.emit(task)
            
            domain = self._extract_domain(url)
            worker_cls = self._get_worker_for_domain(domain)
            worker = worker_cls(url)
            
            worker.success.connect(self._on_download_success)
            worker.failed.connect(self._on_download_failed)
            worker.setAutoDelete(True)
            
            logger.info(f"[MediaService] {worker_cls.__name__} 실행됨 ({domain})")
            QThreadPool.globalInstance().start(worker)
        except Exception as e:
            logger.exception(f"다운로드 작업 생성 실패: {url}")
            self.error_occurred.emit(f"다운로드 실패: {e}")
    
    
    def _on_download_success(self, media_info: DownloadMediaInfo):
        logger.info(f"[MediaService] DB에 저장 시도: {media_info.source_url}")
        platform = self._get_platform_from_url(media_info.source_url)
        added_items: list[MediaItem] = []
        
        try:
            for file_info in media_info.files:
                media = Media(
                    title=media_info.title or Path(file_info.filename).stem,
                    filepath=file_info.filepath,
                    url=media_info.source_url,
                    thumbnail_path=file_info.thumbnail_url,
                    filesize=file_info.filesize,
                    platform_id=platform.id
                )
                ui_item = self.media_repo.create_and_get_item(media)
                added_items.append(ui_item)
            if added_items:
                self._add_items_to_cache_and_emit(added_items)
        except Exception as e:
            logger.exception("DB 저장 실패")
            self.error_occurred.emit(f"DB 저장 실패: {e}")
    
    def _on_download_failed(self, message: str):
        self.error_occurred.emit(f"다운로드 실패: {message}")
    
    def _extract_domain(self, url: str) -> str:
        try:
            host = urlparse(url).netloc.split(":")[0]
            parts = host.split(".")
            return parts[-2].lower() if len(parts) >= 2 and parts[-2] != 'www' else parts[-1].lower()
        except IndexError:
            return "unknown"
    
    def _get_platform_from_url(self, url: str) -> Platform:
        domain = self._extract_domain(url)
        return self.platform_repo.get_or_create(domain)
    
    def _get_worker_for_domain(self, domain: str):
        if domain in ("instagram", "insta"):
            return InstaloaderWorker
        return YtdlpWorker
    
    def _add_items_to_cache_and_emit(self, new_items: list[MediaItem]):
        self._all_media_items_cache.extend(new_items)
        self.media_added.emit(new_items)