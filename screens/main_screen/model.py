from dataclasses import dataclass
from typing import List, Optional

@dataclass
class MediaItem:
    title: str
    filepath: str
    thumbnail_path: Optional[str]