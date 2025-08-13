from sqlalchemy.orm import selectinload
from sqlmodel import Session, SQLModel, select, func
from typing import Type, TypeVar, List, Optional, Dict

from src.database.settings import get_session
from src.database.models.media import Media
from src.database.models.platform import Platform
from src.database.models.profile import Profile
from src.database.models.tag import Tag
from src.database.models.media_data import MediaData


T = TypeVar("T", bound=SQLModel)
class BaseRepository:
    def __init__(self, model: Type[T]):
        self.model = model
    
    def get(self, id: int) -> Optional[T]:
        with get_session() as session:
            return session.get(self.model, id)

    def get_all(self) -> List[T]:
        with get_session() as session:
            statement = select(self.model)
            return session.exec(statement).all()
    
    def create(self, obj_in: Dict) -> T:
        with get_session() as session:
            db_obj = self.model(**obj_in)
            session.add(db_obj)
            session.commit()
            session.refresh(db_obj)
            return db_obj

    def delete(self, id: int) -> bool:
        with get_session() as session:
            obj = session.get(self.model, id)
            if obj:
                session.delete(obj)
                session.commit()
                return True
            return False
        
class PlatformRepository(BaseRepository):
    def __init__(self):
        super().__init__(Platform)
    
    def get_or_create(self, name: str) -> Platform:
        with get_session() as session:
            statement = select(Platform).where(Platform.name == name.lower())
            platform = session.exec(statement).first()
            if not platform:
                platform = self.create({"name": name.lower()})
            return platform

class ProfileRepository(BaseRepository):
    def __init__(self):
        super().__init__(Profile)
    
    def get_or_create(self, owner_name: str, proifile_id: str = None) -> Profile:
        with get_session() as session:
            proifile_id = proifile_id or owner_name
            statement = select(Profile).where(Profile.profile_id == proifile_id)
            profile = session.exec(statement).first()
            if not profile:
                profile_data = {"owner_name": owner_name, "profile_id": proifile_id}
                profile = self.create(profile_data)
            return profile

class MediaRepository(BaseRepository):
    def __init__(self):
        super().__init__(Media)
    
    def get_all_paginated(self, session, page: int, page_size: int) -> List[Media]:
        if page < 1:
            page = 1
        offset = (page - 1) * page_size
        statement = (
            select(self.model)
            .options(selectinload(Media.platform), selectinload(Media.profile))
            .order_by(Media.created_at.desc())
            .offset(offset).limit(page_size)
        )
        return session.exec(statement).all()

    def create_with_relations(self, media_data: MediaData) -> Media:
        with get_session() as session:
            platform_repo = PlatformRepository()
            profile_repo = ProfileRepository()
            
            platform_id = None
            if media_data.platform:
                platform = platform_repo.get_or_create(media_data.platform)
                platform_id = platform.id

            profile_id = None
            if media_data.uploader:
                profile = profile_repo.get_or_create(
                    owner_name=media_data.uploader,
                    proifile_id=media_data.uploader_id
                )
                profile_id = profile.id

            media = Media(
                title=media_data.title,
                filepath=media_data.filepath,
                url=media_data.url,
                filesize=media_data.filesize,
                thumbnail_path=media_data.thumbnail_path,
                platform_id=platform_id,
                profile_id=profile_id,
            )

            session.add(media)
            session.commit()
            session.refresh(media)
            print(f"[DB] 미디어 레코드 저장 완료: {media_data.title}")
            return media