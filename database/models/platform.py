from typing import List
from sqlmodel import SQLModel, Field, Relationship
from pydantic import field_validator
from src.database.models.media import Media


class Platform(SQLModel, table=True):
    __tablename__ = "platform"

    id: int = Field(default=None, primary_key=True)
    name: str = Field(nullable=False, unique=True)

    medias: List["Media"] = Relationship(back_populates="platform")

    @field_validator("name")
    def validate_name_alpha_lower(cls, v: str) -> str:
        if not v.isalpha():
            raise ValueError("플랫폼 명은 영어만 가능합니다.")
        return v.lower()

    
    class Config:
        from_attributes = True