import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QPixmap, QIcon
from PySide6.QtWidgets import (QListWidget, QListWidgetItem,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from src.database.repository import MediaRepository
from src.ui.widgets.list_item_widget import ListItemWidget


class ListPage(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)

        self.media_repo = MediaRepository()
        self.current_page = 1
        self.page_size = 25
        self.is_loading = False
        self.is_last_page = False
        self.db_worker = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(10)

        self.list_widget = QListWidget()
        self.list_widget.setSpacing(5)
        layout.addWidget(self.list_widget)

        self.list_widget.itemDoubleClicked.connect(self.open_file_location)
        self.list_widget.verticalScrollBar().valueChanged.connect(self.on_scroll_changed)
        self.load_next_page()

    def load_next_page(self):
        if self.is_loading or self.is_last_page:
            return

        self.is_loading = True
        self.db_worker = self.media_repo.get_all_paginated_async(
            page=self.current_page,
            page_size=self.page_size
        )
        self.db_worker.finished.connect(self.append_to_list)
        self.db_worker.error.connect(self.on_db_error)
        self.db_worker.finished.connect(self.db_worker.deleteLater)
        self.db_worker.error.connect(self.db_worker.deleteLater)
        self.db_worker.start()

    def append_to_list(self, media_list: list):
        if not media_list:
            self.is_last_page = True
            self.is_loading = False
            return
        
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

    def open_file_location(self, item: QTableWidgetItem):
        media = item.data(Qt.UserRole)
        if not media or not media.filepath:
            return
        
        path = Path(media.filepath)
        if not path.exists():
            path = path.parent
            if not path.exists():
                print(f"Path not found: {path}")
                return
        try:
            if sys.platform == "win32":
                subprocess.run(["explorer", "/select,", str(path)], check=True)
            elif sys.platform == "darwin":
                subprocess.run(["open", "-R", str(path.parent)], check=True)
            else:
                subprocess.run(["xdg-open", str(path.parent)], check=True)
        except (FileNotFoundError, subprocess.CalledProcessError) as e:
            print(f"Failed to open file explorer: {e}")

    def on_db_error(self, error_msg: str):
        print(f"Database Error: {error_msg}")
        self.is_loading = False

    def refresh(self):
        if self.is_loading and self.db_worker:
            self.db_worker.terminate()
            self.db_worker.wait()

        self.list_widget.clear()
        self.current_page = 1
        self.is_loading = False
        self.is_last_page = False
        self.load_next_page()
    
    def showEvent(self, event):
        super().showEvent(event)
        self.refresh()