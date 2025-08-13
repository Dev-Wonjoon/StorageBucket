import subprocess
import sys
import logging
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QListWidget, QListWidgetItem, QVBoxLayout, QWidget

from src.core.config import Config
from src.database.settings import get_session
from src.database.repository import MediaRepository
from src.services.thread_manager import Task, thread_manager
from src.ui.widgets.list_item_widget import ListItemWidget

logger = logging.getLogger(__name__)

class ListPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)

        self.media_repo = MediaRepository()
        self.current_page = 1
        self.page_size = 25
        self.is_loading = False
        self.is_last_page = False
        self.current_load_id = 0

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)

        self.list_widget = QListWidget()
        self.list_widget.setSpacing(5)
        layout.addWidget(self.list_widget)

        self.list_widget.itemDoubleClicked.connect(self.open_file_location)
        self.list_widget.verticalScrollBar().valueChanged.connect(self.on_scroll_changed)

    def load_next_page(self):
        if self.is_loading or self.is_last_page:
            return
        
        self.is_loading = True
        logger.info(f"페이지 {self.current_page} 로딩 시작...")
        
        load_id_for_task = self.current_load_id
        
        def _fetch_data(page, page_size):
            with get_session() as session:
                return self.media_repo.get_all_paginated(session, page, page_size)
        
        task = Task(
            target=_fetch_data,
            args=(self.current_page, self.page_size),
            on_success=lambda result: self.append_to_list(result, load_id_for_task),
            on_error=lambda error_msg: self.on_db_error(error_msg, load_id_for_task)
        )
        
        thread_manager.submit(task)

    def append_to_list(self, media_list: list, load_id: int):
        if load_id != self.current_load_id:
            logger.debug(f"오래된 작업(ID:{load_id})의 결과는 무시합니다.")
            return

        if not media_list:
            self.is_last_page = True
        else:
            for media in media_list:
                item_widget = ListItemWidget(media)
                list_item = QListWidgetItem(self.list_widget)
                list_item.setSizeHint(item_widget.sizeHint())
                list_item.setData(Qt.UserRole, media)
                
                self.list_widget.addItem(list_item)
                self.list_widget.setItemWidget(list_item, item_widget)
            self.current_page += 1
        
        self.is_loading = False

    def on_scroll_changed(self, value):
        scroll_bar = self.list_widget.verticalScrollBar()
        if value >= scroll_bar.maximum() * 0.95:
            self.load_next_page()

    def open_file_location(self, item: QListWidgetItem):
        media = item.data(Qt.UserRole)
        if not media or not media.filepath:
            return
        
        path = Path(media.filepath)
        if not path.exists():
            path = path.parent
            if not path.exists():
                logger.warning(f"경로를 찾을 수 없습니다: {path}")
                return
        try:
            if sys.platform == "win32":
                subprocess.run(["explorer", "/select,", str(path)], check=True)
            elif sys.platform == "darwin":
                subprocess.run(["open", "-R", str(path)], check=True)
            else:
                subprocess.run(["xdg-open", str(path.parent)], check=True)
        except (FileNotFoundError, subprocess.CalledProcessError) as e:
            logger.error(f"파일 탐색기를 여는 데 실패했습니다: {e}")

    def on_db_error(self, error_msg: str, load_id: int):
        if load_id != self.current_load_id:
            return
            
        logger.error(f"데이터베이스 오류: {error_msg}")
        self.is_loading = False

    def refresh(self):
        self.current_load_id += 1
        self.is_loading = False
        
        self.list_widget.clear()
        self.current_page = 1
        self.is_last_page = False
        self.load_next_page()
    
    def showEvent(self, event):
        super().showEvent(event)
        self.refresh()