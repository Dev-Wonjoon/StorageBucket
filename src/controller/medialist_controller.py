from PySide6.QtCore import QObject, Signal

from src.database.repository import MediaRepository, TagRepository
from src.database.settings import get_session
from src.services.thread_manager import Task, thread_manager


class MediaListController(QObject):
    page_loaded = Signal(list, int)
    error = Signal(str, int)
    reset_done = Signal()
    end_reached = Signal()
    tags_added = Signal(list, list)
    
    def __init__(self, page_size: int = 25, parent=None):
        super().__init__(parent)
        self.media_repo = MediaRepository()
        self.tag_repo = TagRepository()
        self.page_size = page_size
        self.current_page = 1
        self.is_loading = False
        self.is_last_page = False
        self.current_load_id = 0
        
    def refresh(self):
        self.current_load_id += 1
        self.current_page = 1
        self.is_loading = False
        self.is_last_page = False
        self.reset_done.emit()
        self.load_next_page()
    
    def load_next_page(self):
        if self.is_loading or self.is_last_page:
            return
        load_id_for_task = self.current_load_id
        self.is_loading = True
        
        def _fetch(page, size):
            with get_session() as session:
                return self.media_repo.get_all_paginated(session, page, size)
        
        def _on_success(media_list):
            if load_id_for_task != self.current_load_id:
                self.is_loading = False
                return
            if not media_list:
                self.is_last_page = True
                self.end_reached.emit()
            else:
                self.current_page += 1
            self.is_loading = False
            self.page_loaded.emit(media_list or [], load_id_for_task)
    
        def _on_error(error_msg: str):
            if load_id_for_task != self.current_load_id:
                self.is_loading = False
                return
            self.is_loading = False
            self.error.emit(error_msg, load_id_for_task)
        
        task = Task(
            target=_fetch,
            args=(self.current_page, self.page_size),
            on_success=_on_success,
            on_error=_on_error,
        )
        thread_manager.submit(task)
    
    def add_tags_to_media(self, media_ids: list[int], tags: list[str]):
        if not media_ids or not tags:
            return
        
        def _work(ids, tag_list):
            norm, seen = [], set()
            for t in tag_list:
                s = (t or "").strip().lower()
                if not s or s in seen:
                    continue
                seen.add(s); norm.append(s)
            from sqlmodel import select
            with get_session() as session:
                if hasattr(self.tag_repo, "upsert_by_names"):
                    tag_rows = self.tag_repo.upsert_by_names(norm, session=session)
                else:
                    from src.database.models.tag import Tag
                    tag_rows = []
                    stmt = select(Tag).where(Tag.name.in_(norm))
                    existing = {t.name: t for t in session.exec(stmt).all()}
                    for name in norm:
                        tag = existing.get(name)
                        if not tag:
                            tag = Tag(name=name)
                            session.add(tag)
                            session.flush()
                        tag_rows.append(tag)
                tag_ids = [t.id for t in tag_rows]
            
                if 