from sqlmodel import Session, select

from .generic_repository import GenericRepository
from database.models.tag import Tag


class TagRepository(GenericRepository[Tag]):
    def __init__(self, session: Session):
        super().__init__(session, Tag)
        
    def get_by_name(self, name: str) -> Tag | None:
        stmt = select(Tag).where(Tag.name == name)
        return self.session.exec(stmt).first()
    
    def get_or_create_by_name(self, name: str) -> Tag:
        tag = self.get_by_name(name)
        if not tag:
            tag = self.create(Tag(name=name))
        return tag