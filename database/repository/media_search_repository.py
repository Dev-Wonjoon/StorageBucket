from typing import List, Optional, Tuple
from core.database import SessionLocal
from database.models.media import Media
from screens.main_window.model import MediaItem


class MediaSearchRepository:
    def __init__(self, to_item):
        self._to_item = to_item
    
    def search(
        self,
        filters: List[Tuple[str, str, str]],
    ) -> List[MediaItem]:
        """
        filters: (field, keyword, operator) 리스트,
        - field: "title" | "tag" | "profile" | "platform"
        - keyword: 검색어
        - operator: "AND" | "OR"
        """
        conditions = []
        params = {}
        
        for idx, (field, keyword, operator) in enumerate(filters):
            if not keyword:
                continue
            
            key = f"kw{idx}"
            
            if field == "title":
                cond = f"fts MATCH :{key}"
            elif field == "tag":
                cond = f"t.name LIKE :{key}"
                params[key] = f"%{keyword}%"
            elif field == "profile":
                cond = f"p.owner_name LIKE :{key}"
                params[key] = f"%{keyword}%"
            elif field == "platform":
                cond = f"pl.name LIKE :{key}"
                params[key] = f"%{keyword}%"
            else:
                continue
            
            if not conditions:
                conditions.append(cond)
            else:
                conditions.append(f"{operator} {cond}")
        
        where_sql = " ".join(conditions) if conditions else "1=1"
        
        query = f"""
            SELECT DISTINCT m.*
            FROM media m
            LEFT JOIN media_fts fts ON m.id = fts.rowid
            LEFT JOIN media_tag mt ON m.id = mt.media_id
            LEFT JOIN tag t ON mt.tag_id = t.id
            LEFT JOIN profile p ON m.profile_id = p.id
            LEFT JOIN platform pl ON m.platform_id = pl.id
            WHERE {where_sql}
        """
        
        with SessionLocal() as session:
            result = session.exec(query, params)
            return [self._to_item(media) for media in result]