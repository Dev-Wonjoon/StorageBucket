from dataclasses import dataclass
from typing import Optional

@dataclass(frozen=True)
class MediaData:
    title: str
    filepath: str
    url: Optional[str]
    platform: Optional[str]
    uploader: Optional[str]
    uploader_id: Optional[str]
    thumbnail_path: Optional[str] = None
    filesize: Optional[int] = None
    
    @staticmethod
    def builder() -> "MediaDataBuilder":
        return MediaDataBuilder()


class MediaDataBuilder:    
    def __init__(self):
        self._data = {
            "title": "No Title",
            "filepath": None,
            "url": None,
            "platform": None,
            "uploader": None,
            "uploader_id": None,
            "thumbnail_path": None,
            "filesize": None
        }
        
    def with_dict(self, source_dict: dict) -> "MediaDataBuilder":
        if "title" in source_dict: self._data['title'] = source_dict["title"]
        if "filepath" in source_dict: self._data['filepath'] = str(source_dict["filepath"])
        if "url" in source_dict: self._data['url'] = source_dict["url"]
        if "uploader" in source_dict: self._data['uploader'] = source_dict["uploader"]
        if "uploader_id" in source_dict: self._data['uploader_id'] = source_dict["uploader_id"]
        if "thumbnail_path" in source_dict: self._data['thumbnail_path'] = source_dict["thumbnail_path"]
        if "filesize" in source_dict: self._data['filesize'] = source_dict["filesize"]
        return self

    def with_platform(self, platform: str) -> "MediaDataBuilder":
        self._data["platform"] = platform
        return self

    def build(self) -> "MediaData":
        if not self._data.get("filepath"):
            raise ValueError("Filepath는 필수 값 입니다.")
        return MediaData(**self._data)