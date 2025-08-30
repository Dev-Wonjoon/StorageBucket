import logging
from PySide6.QtCore import QObject, Signal, Slot
from core.config import ConfigManager
from screens.main_window.model import MediaItem
from database.repository.media_repository import MediaRepository
from database.repository.tag_repository import TagRepository
from database.models.media import Media
from screens.main_window.model import MediaItem
from workers.base_worker import BaseDownloadWorker

logger = logging.getLogger(__name__)

class MediaService(QObject):
    media_added = Signal(MediaItem)
    error_occurred = Signal(str)
    
    def __init__(self, media_repo: MediaRepository, tag_repo: TagRepository, config: ConfigManager):
        super().__init__()
        self.media_repo = media_repo
        self.tag_repo = tag_repo
        self.config = config
        self.download_worker = None
        self._all_media_items_cache = []
    
    def get_initial_media_items(self):
        self._all_media_items_cache = self.media_repo.get_all_as_media_items()
        return self._all_media_items_cache
    
    def get_available_tags(self):
        all_tags = self.tag_repo.get_all()
        return ['All'] + [tag.name for tag in all_tags]
    
    def filter_media_by_tag(self, tag_name: str):
        if tag_name == "All":
            return self._all_media_items_cache
        return [
            item for item in self._all_media_items_cache if tag_name in item.tags
        ]
    
    @Slot(str)
    def add_media_from_local(self, filepath: str):
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