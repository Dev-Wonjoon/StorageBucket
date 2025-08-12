from sqlmodel import SQLModel, Field, Column, BigInteger, Relationship
from typing import Optional, List
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
    url: Optional[str] = Field(default=None, nullable=True)
    filesize: Optional[int] = Field(default=None, sa_column=Column(BigInteger, nullable=True))
    thumbnail_path: str = Field(default=None, nullable=True)
    
    platform_id: Optional[int] = Field(index=True, foreign_key="platform.id", nullable=True)
    profile_id: Optional[int] = Field(foreign_key="profile.id", nullable=True)
    created_at: datetime = Field(default_factory=datetime.now, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.now, sa_column_kwargs={"onupdate": datetime.now}, nullable=False)
    
    platform: "Platform" = Relationship(back_populates="medias")
    profile: "Profile" = Relationship(back_populates="medias")
    tags: List["Tag"] = Relationship(back_populates="medias", link_model=MediaTag)