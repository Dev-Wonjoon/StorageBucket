import subprocess
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QAbstractItemView, QHeaderView, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from src.database.repository import MediaRepository


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

        self.table = QTableWidget()
        self.table.setColumnCount(5)
        self.table.setHorizontalHeaderLabels(["ID", "Title", "Platform", "Uploader", "File Path"])
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        layout.addWidget(self.table)

        self.table.itemDoubleClicked.connect(self.open_file_location)
        self.table.verticalScrollBar().valueChanged.connect(self.on_scroll_changed)

        self.load_next_page()

    def load_next_page(self):
        if self.is_loading or self.is_last_page:
            return

        self.is_loading = True
        self.db_worker = self.media_repo.get_all_paginated_async(
            page=self.current_page,
            page_size=self.page_size
        )
        self.db_worker.finished.connect(self.append_to_table)
        self.db_worker.error.connect(self.on_db_error)
        self.db_worker.finished.connect(self.db_worker.deleteLater)
        self.db_worker.error.connect(self.db_worker.deleteLater)
        self.db_worker.start()

    def append_to_table(self, media_list: list):
        if not media_list:
            self.is_last_page = True
            self.is_loading = False
            return

        for media in media_list:
            row_position = self.table.rowCount()
            self.table.insertRow(row_position)
            self.table.setItem(row_position, 0, QTableWidgetItem(str(media.id)))
            self.table.setItem(row_position, 1, QTableWidgetItem(media.title))
            self.table.setItem(row_position, 2, QTableWidgetItem(media.platform.name if media.platform else "N/A"))
            self.table.setItem(row_position, 3, QTableWidgetItem(media.profile.owner_name if media.profile else "N/A"))
            self.table.setItem(row_position, 4, QTableWidgetItem(media.filepath))

        self.current_page += 1
        self.is_loading = False

    def on_scroll_changed(self, value):
        scroll_bar = self.table.verticalScrollBar()
        if value >= scroll_bar.maximum() * 0.95:
            self.load_next_page()

    def open_file_location(self, item: QTableWidgetItem):
        row = item.row()
        filepath_item = self.table.item(row, 4)
        if not filepath_item:
            return

        path = Path(filepath_item.text())
        if not path.exists():
            path = path.parent
            if not path.exists():
                print(f"Path not found: {path}")
                return

        try:
            if sys.platform == "win32":
                subprocess.run(["explorer", "/select,", str(path)], check=True)
            elif sys.platform == "darwin":
                subprocess.run(["open", "-R", str(path)], check=True)
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
        self.table.setRowCount(0)
        self.current_page = 1
        self.is_loading = False
        self.is_last_page = False
        self.load_next_page()
    
    def showEvent(self, event):
        super().showEvent(event)
        self.refresh()