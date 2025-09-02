from sqlmodel import Session, select

from .generic_repository import GenericRepository
from database.models.platform import Platform


class PlatformRepository(GenericRepository[Platform]):
    def __init__(self, session: Session):
        super().__init__(session, Platform)
    
    def get_by_name(self, name: str) -> Platform | None:
        stmt = select(Platform).where(Platform.name == name.lower())
        return self.session.exec(stmt).first()
    
    def get_or_create(self, name: str) -> Platform | None:
        normalized = name.lower()
        stmt = select(Platform).where(Platform.name == normalized)
        platform = self.session.exec(stmt).first()
        if platform:
            return platform
        
        platform = Platform(name=normalized)
        self.session.add(platform)
        self.session.commit()
        self.session.refresh(platform)
        return platform