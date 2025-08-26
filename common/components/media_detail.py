# TODO: 추후에 적절한 기능이 추가되면 옮길 예정

from dataclasses import dataclass
from typing import Optional, List

@dataclass
class MediaDetailItem:
    title: str
    filepath: str
    filesize_str: str
    created_at_str: str
    platform_name: Optional[str]
    profile_owner: Optional[str]
    tags: List[str]