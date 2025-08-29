from typing import List, Optional
from sqlmodel import Session, select
from sqlalchemy.orm import selectinload

from .generic_repository import GenericRepository
from screens.main_window.model import MediaItem
from common.components.media_detail import MediaDetailItem
from ..models.media import Media
from ..models.tag import Tag

class MediaRepository(GenericRepository[Media]):
    def __init__(self, session: Session):
        super().__init__(session, Media)
    
    def get_all_as_media_items(self) -> List[MediaItem]:
        results = self.get_all()
    
        return [
            MediaItem(
                id=media.id,
                title=media.title,
                thumbnail_path=media.thumbnail_path or media.filepath,
                profile_name=media.profile.owner_name if media.profile else "Unknown",
                tags=[tag.name for tag in media.tags]
            ) for media in results
        ]
    
    def get_details_as_media_detail_item(self, media_id: int) -> Optional[MediaDetailItem]:
        stmt = (
            select(Media)
            .where(Media.id == media_id)
            .options(
                selectinload(Media.profile),
                selectinload(Media.platform),
                selectinload(Media.tags)
            )
        )
        media = self.session.exec(stmt).first()
        if not media: return None
    
        filesize_str = f"{round(media.filesize / (1024*1024), 2)} MB" if media.filesize else "N/A"
        created_at_str = media.created_at.strftime("%Y년 %m월 %d일 %H:%M")
        platform_name = media.platform.name if media.platform else "없음"
        profile_owner = media.profile.owner_name if media.profile else "없음"
        tags = [f"#{tag.name}" for tag in media.tags]
        
        return MediaDetailItem(
            title=media.title,
            filepath=media.filepath,
            filesize_str=filesize_str,
            created_at_str=created_at_str,
            platform_name=platform_name,
            profile_owner=profile_owner,
            tags=tags
        )