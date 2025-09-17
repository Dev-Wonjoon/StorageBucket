from PySide6.QtWidgets import QListWidget, QListWidgetItem, QListView
from PySide6.QtGui import QPixmap
from common.components.gallery_item.gallery_item import GalleryItemWidget
from core.config import ConfigManager


class GalleryListWidget(QListWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setViewMode(QListView.ViewMode.IconMode)
        self.setResizeMode(QListView.ResizeMode.Adjust)
        self.setMovement(QListWidget.Movement.Static)
        self.setSpacing(20)
        self.setFlow(QListView.Flow.LeftToRight)
        self.setWrapping(True)
        self.config = ConfigManager()
        self._placeholder_image = self._load_placeholder()
        
    def update_items(self, items):
        self.clear()
        for data in items:
            list_item = QListWidgetItem(self)
            custom_widget = GalleryItemWidget(data, self._placeholder_image)
            list_item.setSizeHint(custom_widget.sizeHint())
            self.addItem(list_item)
            self.setItemWidget(list_item, custom_widget)
    
    def _load_placeholder(self) -> QPixmap | None:
        theme = self.config.get_theme()
        placeholder_path = self.config.get_assets_path() / theme / "damage-file-icon.png"
        if placeholder_path.exists():
            return QPixmap(str(placeholder_path))
        return None
    
    