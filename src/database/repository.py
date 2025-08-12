from PySide6.QtCore import QObject, QThread, Signal
from sqlalchemy.orm import selectinload
from sqlmodel import Session, SQLModel, select, func
from typing import Type, TypeVar, List, Optional, Dict

from src.database.settings import get_session
from src.database.models.media import Media
from src.database.models.platform import Platform
from src.database.models.profile import Profile
from src.database.models.tag import Tag


T = TypeVar("T", bound=SQLModel)
class BaseRepository:
    def __init__(self, model: Type[T]):
        self.model = model
    
    def get(self, db_session: Session, id: int) -> Optional[T]:
        return db_session.get(self.model, id)

    def get_all(self, db_session: Session) -> List[T]:
        statement = select(self.model)
        return db_session.exec(statement).all()
    
    def create(self, db_session: Session, obj_in: Dict) -> T:
        db_obj = self.model(**obj_in)
        db_session.add(db_obj)
        db_session.commit()
        db_session.refresh(db_obj)
        return db_obj

    def update(self, db_session: Session, db_obj: T, obj_in: Dict) -> T:
        for key, value in obj_in.items():
            setattr(db_obj, key, value)
        db_session.add(db_obj)
        db_session.commit()
        db_session.refresh(db_obj)
        return db_obj

    def delete(self, db_session: Session, id: int) -> bool:
        obj = db_session.get(self.model, id)
        if obj:
            db_session.delete(obj)
            db_session.commit()
            return True
        return False
        

class PlatformRepository(BaseRepository):
    def __init__(self):
        super().__init__(Platform)
    
    def get_or_create(self, db_session: Session, name: str) -> Platform:
        statement = select(Platform).where(Platform.name == name.lower())
        platform = db_session.exec(statement).first()
        if not platform:
            platform = self.create(db_session, {"name": name.lower()})
        return platform

class ProfileRepository(BaseRepository):
    def __init__(self):
        super().__init__(Profile)
    
    def get_or_create(self, db_session: Session, owner_name: str, proifile_id: str = None) -> Profile:
        proifile_id = proifile_id or owner_name
        statement = select(Profile).where(Profile.profile_id == proifile_id)
        profile = db_session.exec(statement).first()
        if not profile:
            profile_data = {"owner_name": owner_name, "profile_id": proifile_id}
            profile = self.create(db_session, profile_data)
        return profile
            
        

class TagRepository(BaseRepository):
    def __init__(self):
        super().__init__(Tag)
    
    def get_or_create(self, db_session: Session, name: str) -> Optional[Tag]:
        clean_name = name.strip().lower()
        if not clean_name:
            return None
        statement = select(Tag).where(Tag.name == clean_name)
        tag = db_session.exec(statement).first()
        if not tag:
            tag = self.create(db_session, {"name": clean_name})
        return tag

class MediaRepository(BaseRepository):
    def __init__(self):
        super().__init__(Media)
    
    def get_total_count(self, db_session: Session) -> int:
        statement = select(func.count()).select_from(self.model)
        return db_session.exec(statement).one()
    
    def get_all_paginated(self, db_session: Session, page: int, page_size: int) -> List[Media]:
        if page < 1:
            page = 1
        offset = (page - 1) * page_size
        statement = (select(self.model)
                     .options(selectinload(Media.platform), selectinload(Media.profile))
                     .order_by(Media.created_at.desc())
                     .offset(offset)
                     .limit(page_size))
        return db_session.exec(statement).all()
    
    def create_with_relations(self, db_session: Session, media_data: Dict) -> Media:
        platform_repo = PlatformRepository()
        profile_repo = ProfileRepository()
        
        platform_name = media_data["platform"] or "unknown"
        platform = platform_repo.get_or_create(db_session, name=platform_name)
        profile_id = None
        if media_data["uploader"]:
            profile = profile_repo.get_or_create(db_session, owner_name=media_data["uploader"],
                                             proifile_id=media_data.get("uploader_id"))
            profile_id = profile.id
        
        media = Media(
            title=media_data["title"],
            filepath=str(media_data["filepath"]),
            url=media_data["url"],
            filesize=media_data.get("filesize"),
            thumbnail_path=media_data.get("thumbnail_path"),
            platform_id=platform.id,
            profile_id=profile.id,
        )
        
        db_session.add(media)
        db_session.commit()
        db_session.refresh(media)
        
        print(f"[DB] 미디어 레코드 저장 완료: {media.title}")
        return media