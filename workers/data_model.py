from dataclasses import dataclass
from typing import Optional, List
from datetime import datetime


@dataclass
class FileInfo:
    filepath: str
    filename: str
    filesize: Optional[int] = None
    thumbnail_url: Optional[str] = None
    
    
@dataclass
class DownloadMediaInfo:
    files: List[FileInfo]
    source_url: str
    title: Optional[str] = None
    platform_name: Optional[str] = None
    uploader: Optional[str] = None
    upload_date: Optional[str] = None