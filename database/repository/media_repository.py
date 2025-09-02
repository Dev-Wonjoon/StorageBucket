from typing import List, Optional
from sqlmodel import select
from sqlalchemy.orm import selectinload

from .generic_repository import GenericRepository
from screens.main_window.model import MediaItem
from common.components.media_detail import MediaDetailItem
from core.database import SessionLocal
from database.models.media import Media

class MediaRepository(GenericRepository[Media]):
    def __init__(self):
        super().__init__(Media)
    
    def create_and_get_item(self, obj_in: Media):
        with SessionLocal() as session:
            session.add(obj_in)
            session.commit()
            session.refresh(obj_in)
            
            profile_name = obj_in.profile.owner_name if obj_in.profile else "Unknown"
            tags = [tag.name for tag in obj_in.tags] if obj_in.tags else []
            
            return MediaItem(
                id=obj_in.id,
                title=obj_in.title,
                filepath=obj_in.filepath,
                thumbnail_path=obj_in.thumbnail_path or obj_in.filepath,
                platform_name=obj_in.platform.name,
                profile_name=profile_name,
                tags=tags
            )
    
    def get_all_as_media_items(self) -> List[MediaItem]:
        with SessionLocal() as session:
            results = session.exec(select(Media)).all()
            return [
                MediaItem(
                    id=media.id,
                    title=media.title,
                    filepath=media.filepath,
                    thumbnail_path=media.thumbnail_path or media.filepath,
                    profile_name=media.profile.owner_name if media.profile else "Unknown",
                    platform_name=media.platform.name if media.platform else "Unknown",
                    tags=[tag.name for tag in media.tags] if media.tags else []
                ) for media in results
            ]
    
    def get_details_as_media_detail_item(self, media_id: int) -> Optional[MediaDetailItem]:
        with SessionLocal() as session:
            stmt = (
                select(Media)
                .where(Media.id == media_id)
                .options(
                    selectinload(Media.profile),
                    selectinload(Media.platform),
                    selectinload(Media.tags)
                )
            )
            media = session.exec(stmt).first()
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