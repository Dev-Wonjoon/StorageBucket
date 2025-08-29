import time
from PySide6.QtCore import QObject, Signal, QThread, Slot
from ..screens.main_window.model import MediaItem
from ..database.repository.media_repository import MediaRepository
from ..database.models.media import Media
from ..screens.main_window.model import MediaItem


class MediaService(QObject):
    media_added = Signal(MediaItem)
    error_occurred = Signal(str)
    
    def __init__(self, media_repo: MediaRepository):
        super().__init__()
        self.media_repo = media_repo
        self.download_worker = None
    
    @Slot(str)
    def add_media_from_local(self, filepath: str):
        try:
            new_media = self.media_repo.create(Media()