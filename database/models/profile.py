from datetime import datetime
from typing import List
from sqlmodel import SQLModel, Field, Relationship
from pydantic import field_validator
from database.models.media import Media


class Profile(SQLModel, table=True):
    __tablename__ = "profile"
    
    id: int = Field(default=None, primary_key=True)
    profile_id: str = Field(default=None, nullable=False)
    owner_name: str = Field(default=None, nullable=False)
    
    medias: List["Media"] = Relationship(back_populates="profile")
    
    updated_at: datetime = Field(default_factory=datetime.now)