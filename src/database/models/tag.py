from sqlmodel import Field, Relationship, SQLModel
from typing import Optional, List
from src.database.models.media import Media


class Tag(SQLModel, table=True):
    __tablename__ = "tag"
    
    id: Optional[int] = Field(primary_key=True)
    name: str = Field(nullable=False, unique=True)
    
    media: List