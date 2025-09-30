import logging
from PySide6.QtCore import QObject, Signal, Slot
from database.repository.media_search_repository import MediaSearchRepository
from services.media_service import MediaService

logger = logging.getLogger(__name__)


class MainWindowViewModel(QObject):
    media_items_changed = Signal(list)
    available_tags_changed = Signal(list)
    new_media_items_added = Signal(list)
    
    def __init__(self,  media_service: MediaService, search_repo: MediaSearchRepository):
        super().__init__()
        self.media_service = media_service
        self.search_repo = search_repo
        self.media_service.media_added.connect(self.new_media_items_added)
        self.new_media_items_added.connect(self.refresh_gallery)
        
    @Slot()
    def inital_load(self):
        self._all_media_items = self.media_service.get_initial_media_items()
        self.media_items_changed.emit(self._all_media_items)
        
        tags = self.media_service.get_available_tags()
        self.available_tags_changed.emit(tags)
    
    @Slot(str)
    def filter_by_tag(self, tag_name: str):
        filtered_items = self.media_service.filter_media_by_tag(tag_name)
        self.media_items_changed.emit(filtered_items)
    
    @Slot()
    def refresh_gallery(self):
        refreshed_items = self.media_service.get_initial_media_items()
        self.media_items_changed.emit(refreshed_items)
        
    @Slot(str)
    def download_media(self, url: str):
        
        self.media_service.download_media(url)
    
    @Slot(list)
    def add_local_list(self, filepaths: list[str]):
        for path in filepaths:
            self.media_service.add_media_from_local(path)
    
    @Slot(list)
    def search_media(self, filters):
        results = self.search_repo.search(filters)
        self.media_items_changed.emit(results)