from sqlmodel import SQLModel, Field
from typing import Optional

class MediaTag(SQLModel, table=True):
    __tablename__ = "media_tag"
    
    media_id: Optional[int] = Field(foreign_key="media.id", primary_key=True)
    tag_id: Optional[int] = Field(foreign_key="tag.id", primary_key=True)