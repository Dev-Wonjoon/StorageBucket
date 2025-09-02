from PySide6.QtWidgets import QListWidget, QListWidgetItem, QListView
from common.components.gallery_item.widget import GalleryItemWidget


class GalleryListWidget(QListWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setViewMode(QListWidget.ViewMode.IconMode)
        self.setResizeMode(QListView.Adjust)
        self.setMovement(QListWidget.Movement.Static)
        self.setSpacing(20)
        
    def update_items(self, items):
        self.clear()
        for data in items:
            list_item = QListWidgetItem(self)
            custom_widget = GalleryItemWidget(data)
            list_item.setSizeHint(custom_widget.sizeHint())
            self.addItem(list_item)
            self.setItemWidget(list_item, custom_widget)