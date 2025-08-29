from sqlmodel import Session, select

from .generic_repository import GenericRepository
from database.models.profile import Profile


class ProfileRepository(GenericRepository[Profile]):
    def __init__(self, session: Session):
        super().__init__(session, Profile)
        
    def get_by_profile_id(self, profile_id: str) -> Profile | None:
        stmt = select(Profile).where(Profile.profile_id == profile_id)
        return self.session.exec(stmt).first()