from datetime import datetime
from sqlmodel import Field, Relationship, SQLModel
from typing import Optional, List

from database.models.media import MediaTag


class Tag(SQLModel, table=True):
    __tablename__ = "tag"
    
    id: Optional[int] = Field(primary_key=True)
    name: str = Field(nullable=False, unique=True)
    
    medias: List["Media"] = Relationship(back_populates="tags", link_model=MediaTag)
    updated_at: datetime = Field(default_factory=datetime.now, sa_column_kwargs={"onupdate": datetime.now})