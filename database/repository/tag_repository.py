from sqlmodel import Session, select

from .generic_repository import GenericRepository
from core.database import SessionLocal
from database.models.tag import Tag


class TagRepository(GenericRepository[Tag]):
    def __init__(self):
        super().__init__(Tag)
        
    def get_by_name(self, name: str) -> Tag | None:
        with SessionLocal() as session:
            stmt = select(Tag).where(Tag.name == name)
            return session.exec(stmt).first()
    
    def get_or_create_by_name(self, name: str) -> Tag:
        with SessionLocal() as session:
            stmt = select(Tag).where(Tag.name == name)
            tag = session.exec(stmt).first()
            if tag:
                return tag
            
            tag = Tag(name=name)
            session.add(tag)
            session.commit()
            session.refresh(tag)