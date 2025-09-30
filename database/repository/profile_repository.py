from sqlmodel import Session, select

from .generic_repository import GenericRepository
from database.models.platform import Platform
from database.models.profile import Profile
from core.database import SessionLocal


class ProfileRepository(GenericRepository[Profile]):
    def __init__(self, session: Session):
        super().__init__(session, Profile)
        
    def get_by_owner(self, owner_id: str, platform: Platform) -> Profile | None:
        with SessionLocal() as session:
            stmt = select(Profile).where(
                Profile.owner_id == owner_id,
                Profile.platform_id == platform.id
            )
            return session.exec(stmt).first()
    
    def get_or_create(self, owner_id: str, owner_name: str, platform: Platform) -> Profile:
        with SessionLocal() as session:
            stmt = select(Profile).where(
                Profile.owner_id == owner_id,
                Profile.platform_id == platform.id
            )
            profile = session.exec(stmt).first()
            
            if profile:
                if owner_name and profile.owner_name != owner_name:
                    profile.owner_name = owner_name
                    session.add(profile)
                    session.commit()
                    session.refresh(profile)
                return profile
            
            new_profile = Profile(
                owner_id=owner_id,
                owner_name=owner_name,
                platform_id=platform.id,
            )
            session.add(new_profile)
            session.commit()
            session.refresh(new_profile)
            
            return new_profile