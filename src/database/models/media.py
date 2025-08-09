from sqlmodel import SQLModel, Field, Column, BigInteger
from typing import Optional
from datetime import datetime


class MediaTag(SQLModel, table=True):
    __tablename__ = "media_tag"
    
    media_id: Optional[int] = Field(foreign_key="media.id", primary_key=True)
    tag_id: Optional[int] = Field(foreign_key="tag.id", primary_key=True)


class Media(SQLModel, table=True):
    __tablename__ = "media"
    
    id: int = Field(default=None, primary_key=True)
    title: str = Field(default=None, nullable=False)
    filepath: str = Field(default=None, nullable=False)
    url = Optional[str] = Field(default=None, nullable=True)
    file_size: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    thumbnail_path: str = Field(default=None, nullable=True)
    
    platform_id: Optional[int] = Field(index=True, foreign_key="platform.id", nullable=False)
    owner_id: Optional[int] = Field(foreign_key="profile.owner_id", nullable=True)
    created_at: datetime = Field(default_factory=datetime.now(tz="Asia/Seoul"))
    updated_at: datetime = Field(default_factory=datetime.now(tz="Asia/Seoul"))