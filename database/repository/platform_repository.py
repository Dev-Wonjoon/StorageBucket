from sqlmodel import select

from .generic_repository import GenericRepository
from core.database import SessionLocal
from database.models.platform import Platform



class PlatformRepository(GenericRepository[Platform]):
    def __init__(self):
        super().__init__(Platform)
    
    def get_by_name(self, name: str) -> Platform | None:
        with SessionLocal() as session:
            stmt = select(Platform).where(Platform.name == name.lower())
            return session.exec(stmt).first()
    
    def get_or_create(self, name: str) -> Platform | None:
        with SessionLocal() as session:
            normalized = name.lower()
            stmt = select(Platform).where(Platform.name == normalized)
            platform = session.exec(stmt).first()
            if platform:
                return platform
            
            platform = Platform(name=normalized)
            session.add(platform)
            session.commit()
            session.refresh(platform)
            return platform