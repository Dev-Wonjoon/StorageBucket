import logging
from PySide6.QtCore import QObject, Signal
from database.models.media import Media, MediaTag
from database.models.tag import Tag
from database.repository.tag_repository import TagRepository
from database.repository.media_repository import MediaRepository

logger = logging.getLogger(__name__)

class TagService(QObject):
    tags_changed = Signal()
    error_occurred = Signal(str)
    def __init__(self):
        super().__init__()
        self.tag_repo = TagRepository()
        self.media_repo = MediaRepository()
        
    def get_all_tags(self) -> list[str]:
        try:
            all_tags = self.tag_repo.get_all()
            return [tag.name for tag in all_tags]
        except Exception as e:
            logger.error(f"모든 태그를 가져오는 중 에러 발생: {e}", exc_info=True)
            self.error_occurred.emit("태그를 불러오는데 실패했습니다.")
            return []
    
    def add_tag_to_media(self, media_id: int, tag_name: str):
        try:
            media = self.media_repo.get(media_id)
            if not media:
                raise ValueError(f"ID가 {media_id}인 미디어를 찾을 수 없습니다.")
            
            tag = self.tag_repo.get_or_create_by_name(tag_name.strip())
            
            if tag not in media.tags:
                media.tags.append(tag)
                self.media_repo.create(media)
                logger.info(f"미디어 ID '{media_id}'에 '{tag_name}'을 추가했습니다.")
            else:
                logger.warning(f"미디어 ID '{media_id}'에 '{tag_name}'이 이미 존재합니다.")
        except Exception as e:
            logger.error(f"미디어에 태그 추가 중 오류 발생: {e}", exc_info=True)
            self.error_occurred.emit(f"태그 '{tag_name}' 추가 실패 했습니다.")
    
    def remove_tag_from_media(self, media_id: int, tag_name: str):
        try:
            media = self.media_repo.get(media_id)
            if not media:
                raise ValueError(f"ID가 '{media_id}'인 미디어를 찾을 수 없습니다.")
            
            tag_to_remove = next((tag for tag in media.tags if tag.name == tag_name), None)
            
            if tag_to_remove:
                media.tags.remove(tag_to_remove)
                self.media_repo.create(media)
                logger.info(f"미디어 ID '{media_id}'에서 태그 '{tag_name}'을 제거 했습니다.")
                self.tags_changed.emit()
            else:
                logger.warning(f"미디어 ID '{media_id}'에 태그 '{tag_name}'이 존재하지 않습니다.")
                
        except Exception as e:
            logger.error(f"미디어에서 태그 제거 중 오류 발생: {e}", exc_info=True)
            self.error_occurred.emit(f"태그 '{tag_name}' 제거에 실패했습니다.")