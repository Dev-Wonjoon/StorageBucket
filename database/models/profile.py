from datetime import datetime
from typing import List
from sqlmodel import SQLModel, Field, Relationship, UniqueConstraint
from pydantic import field_validator


class Profile(SQLModel, table=True):
    __tablename__ = "profile"
    __table_args = (
        UniqueConstraint("owner_id", "platform_id", name="uq_owner_platform"),
    )
    
    id: int = Field(default=None, primary_key=True)
    owner_id: str = Field(index=True, nullable=False)
    owner_name: str = Field(default=None)
    platform_id: int = Field(foreign_key="platform.id", nullable=False)
    
    medias: List["Media"] = Relationship(back_populates="profile")
    
    updated_at: datetime = Field(default_factory=datetime.now, nullable=False)