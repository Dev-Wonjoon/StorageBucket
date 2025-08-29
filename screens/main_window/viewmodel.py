from PySide6.QtCore import QObject, Signal, Slot
from database.repository.media_repository import MediaRepository
from database.repository.tag_repository import TagRepository


class MainWindowViewModel(QObject):
    media_items_changed = Signal(list)
    available_tags_changed = Signal(list)
    
    def __init__(self, media_repo: MediaRepository, tag_repo: TagRepository):
        super().__init__()
        self.media_repo = media_repo
        self.tag_repo = tag_repo
        
        self._all_media_items = []
        self._current_filter_tag = "All"
        
    @Slot()
    def inital_load(self):
        self._all_media_items = self.media_repo.get_all_as_media_items()
        self.media_items_changed.emit(self._all_media_items)
        
    @Slot(str)
    def filter_by_tag(self, tag_name: str):
        self._current_filter_tag = tag_name
        
        if tag_name == "All":
            self.media_items_changed.emit(self._all_media_items)
            return
        
        filtered_items = [
            item for item in self._all_media_items if tag_name in item.tags
        ]
        self.media_items_changed.emit(filtered_items)