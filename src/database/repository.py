from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, SQLModel, select, func
from typing import Type, TypeVar, List, Optional, Dict, Iterable

from src.database.settings import get_session
from src.database.models.media import Media, MediaTag
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
    
    def get_or_create(self, name: str, session: Session | None = None) -> Platform:
        close = False
        if session is None:
            session = get_session().__enter__(); close = True
        try:
            nm = name.lower()
            stmt = select(Platform).where(Platform.name == nm)
            plat = session.exec(stmt).first()
            if not plat:
                plat = Platform(name=nm)
                session.add(plat)
                session.flush()
            return plat
        finally:
            if close:
                session.close()

class ProfileRepository(BaseRepository):
    def __init__(self):
        super().__init__(Profile)
    
    def get_or_create(self, owner_name: str, profile_id: str = None, session: Session | None = None) -> Profile:
        close = False
        if session is None:
            session = get_session().__enter__(); close = True
        try:
            _profile_id = profile_id or owner_name
            stmt = select(Profile).where(Profile.profile_id == _profile_id)
            profile = session.exec(stmt).first()
            if not profile:
                profile = Profile(owner_name=owner_name, profile_id=profile_id)
                session.add(profile)
                session.flush()
            return profile
        finally:
            if close:
                session.close()

class MediaRepository(BaseRepository):
    def __init__(self):
        super().__init__(Media)
    
    def attach_tags(self, media_ids: list[int], tag_ids: list[int], session: Session | None = None) -> None:
        if not media_ids or not tag_ids:
            return
        close = False
        if session is None:
            session = get_session().__enter__(); close = True
        
        try:
            stmt = select(MediaTag.media_id, MediaTag.tag_id).where(
                MediaTag.media_id.in_(media_ids),
                MediaTag.tag_id.in_(tag_ids),
            )
            existing = set(session.exec(stmt).all())
            
            for mid in media_ids:
                for tid in tag_ids:
                    if (mid, tid) in existing:
                        continue
                    session.add(MediaTag(media_id=mid, tag_id=tid))
            session.flush()
        finally:
            if close:
                session.close()
    
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
    
class TagRepository(BaseRepository):
    def __init__(self):
        super().__init__(Tag)
    
    @staticmethod
    def _norm(name: str) -> str:
        return (name or "").strip().lower()
    
    def get_by_names(self, names: Iterable[str], session: Session | None = None) -> List[Tag]:
        names = [self._norm(n) for n in names if n and n.strip()]
        if not names:
            return []
        close = False
        if session is None:
            session = get_session().__enter__(); close = True
        try:
            stmt = select(Tag).where(Tag.name.in_(names))
            return list(session.exec(stmt).all())
        finally:
            if close:
                session.close()
    
    def upsert_by_names(self, names: Iterable[str], session: Session | None = None) -> List[Tag]:
        normalized = [self._norm(n) for n in names if n and n.strip()]
        if not normalized:
            return []
        
        close = False
        if session is None:
            session = get_session().__enter__(); close = True
        try:
            existing = {t.name: t for t in self.get_by_names(normalized, session=session)}
            out: list[Tag] = []
            
            for nm in normalized:
                if nm in existing:
                    out.append(existing[nm]); continue
                tag = Tag(name=nm)
                session.add(tag)
                try:
                    session.flush()
                except IntegrityError:
                    session.rollback()
                    t = self.get_by_names([nm], session=session)
                    if t:
                        tag = t[0]
                    else:
                        tag = Tag(name=nm)
                        session.add(tag)
                        session.flush()
                out.append(tag)
            return out
        finally:
            if close:
                session.close()
        