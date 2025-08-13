from pathlib import Path
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QWidget, QVBoxLayout, QListWidget, QListWidgetItem
import sys
from src.ui.widgets.list_item_widget import ListItemWidget
from src.ui.widgets.url_input_widget import UrlInputBar


class MediaListPage(QWidget):
    need_more = Signal()
    item_open_requested = Signal(Path)
    refresh_requested = Signal()
    
    def __init__(self, parent=None):
        super().__init__(parent)
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)
        self.header = UrlInputBar(self)
        layout.addWidget(self.header)
        
        self.list_widget = QListWidget()
        self.list_widget.setSpacing(5)
        layout.addWidget(self.list_widget, 1)
        
        self.list_widget.itemDoubleClicked.connect(self._on_item_double_clicked)
        self.list_widget.verticalScrollBar().valueChanged.connect(self._on_scroll_changed)
        
        self.header.ctrl.task_saved.connect(self.refresh_requested.emit)
    
    def clear(self):
        self.list_widget.clear()
    
    def append_medias(self, media_list: list):
        for media in media_list:
            item_widget = ListItemWidget(media)
            list_item = QListWidgetItem(self.list_widget)
            list_item.setSizeHint(item_widget.sizeHint())
            list_item.setData(Qt.UserRole, media)
            self.list_widget.addItem(list_item)
            self.list_widget.setItemWidget(list_item, item_widget)
    
    def _on_scroll_changed(self, value: int):
        bar = self.list_widget.verticalScrollBar()
        if bar.maximum() > 0 and value >= bar.maximum() * 0.95:
            self.need_more.emit()
    
    def _on_item_double_clicked(self, item: QListWidgetItem):
        media = item.data(Qt.UserRole)
        if not media or not getattr(media, "filepath", None):
            return
        path = Path(media.filepath)
        
        if not path.exists():
            path = path.parent
            if not path.exists():
                return
        self.item_open_requested.emit(path)