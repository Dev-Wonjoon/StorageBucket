from datetime import datetime
from sqlmodel import Field, Relationship, SQLModel
from typing import Optional, List


class Tag(SQLModel, table=True):
    __tablename__ = "tag"
    
    id: Optional[int] = Field(primary_key=True)
    name: str = Field(nullable=False, unique=True)
    
    medias: List["Media"] = Relationship(back_populates="profile")
    updated_at: datetime = Field(default_factory=datetime.now, sa_column_kwargs={"onupdate": datetime.now})