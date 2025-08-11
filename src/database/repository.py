from PySide6.QtCore import QObject, QThread, Signal
from sqlmodel import Session, SQLModel, select, func
from typing import Type, TypeVar, List, Optional, Dict

from src.database.settings import get_session
from src.database.models.media import Media
from src.database.models.platform import Platform
from src.database.models.profile import Profile
from src.database.models.tag import Tag


class DatabaseWriteWorker(QThread):
    error = Signal(str)
    finished = Signal()
    def __init__(self, media_data: Dict, parent=None):
        super().__init__(parent)
        self.media_data = media_data
    def run(self):
        try:
            with get_session() as session:
                media_repo = MediaRepository()
                media_repo.create_with_relations(session, self.media_data)
            self.finished.emit()
        except Exception as e:
            self.error.emit(f"Database write failed: {e}")
            
class DatabaseReadWorker(QThread):
    error = Signal(str)
    finished = Signal(list)
    
    def __init__(self, repo_method, *args, **kwargs):
        super().__init__()
        self.repo_method = repo_method
        self.args = args
        self.kwargs = kwargs
    
    def run(self):
        try:
            with get_session() as session:
                result = self.repo_method(session, *self.args, **self.kwargs)
                self.finished.emit(result if isinstance(result, list) else [result])
        except Exception as e:
            self.error.emit(f"Database read failed: {e}")


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
        statement = select(self.model).order_by(Media.created_at.desc()).offset(offset).limit(page_size)
        return db_session.exec(statement).all()
    
    def get_all_paginated_async(self, page: int, page_size: int, on_finished, on_error):
        worker = DatabaseReadWorker(self.get_all_paginated, page=page, page_size=page_size)
        worker.finished.connect(on_finished)
        worker.error.connect(on_error)
        worker.finished(worker.deleteLater)
        worker.error.connect(worker.deleteLater)
        worker.start()
    
    def create_with_relations(self, db_session: Session, media_data: Dict) -> Media:
        platform_repo = PlatformRepository()
        profile_repo = ProfileRepository()
        tag_repo = TagRepository()
        
        platform = platform_repo.get_or_create(db_session, name=media_data["platform"])
        profile = profile_repo.get_or_create(db_session, owner_name=media_data["uploader"],
                                             owner_id=media_data.get("uploader_id"))
        
        tag_object = []
        if "tags" in media_data and media_data["tags"]:
            for tag_name in media_data["tags"]:
                tag = tag_repo.get_or_create(db_session, name=tag_name)
                if tag:
                    tag_object.append(tag)
        
        media = Media(
            title=media_data["title"],
            filepath=str(media_data["filename"]),
            url=media_data["url"],
            file_size=media_data.get("filesize"),
            platform_id=platform.id,
            profile_id=profile.id,
            tags=tag_object
        )
        
        db_session.add(media)
        db_session.commit()
        db_session.refresh(media)
        
        print(f"[DB] 미디어 레코드 저장 완료: {media.title}")
        return media