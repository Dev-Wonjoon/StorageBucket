from dataclasses import dataclass
from typing import List, Optional

@dataclass
class MediaItem:
    id: int
    title: str
    filepath: str
    thumbnail_path: Optional[str]
    platform_name: Optional[str]
    profile_name: Optional[str]
    tags: List[str]