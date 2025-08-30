from PySide6.QtCore import QObject, Signal, Slot
from services.media_services import MediaService

class MainWindowViewModel(QObject):
    media_items_changed = Signal(list)
    available_tags_changed = Signal(list)
    new_media_items_added = Signal(list)
    
    def __init__(self,  media_service: MediaService):
        super().__init__()
        self.media_service = media_service
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