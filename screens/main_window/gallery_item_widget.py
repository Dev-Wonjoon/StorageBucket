from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel
from PySide6.QtGui import QPixmap
from PySide6.QtCore import Qt
from .model import MediaItem


class GalleryItemWidget(QWidget):
    def __init__(self, item: MediaItem):
        super().__init__()
        self.item = item
        
        layout = QVBoxLayout(self)
        
        self.thumbnail_label = QLabel()
        pixmap = QPixmap(item.thumbnail_path)
        self.thumbnail_label.setPixmap(pixmap.scaled(300, 200, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        
        self.title_label = QLabel(item.title)
        
        self.author_label = QLabel(f"{item.profile_name}")
        
        layout.addWidget(self.thumbnail_label)
        layout.addWidget(self.title_label)
        layout.addWidget(self.author_label)
        
        self.setObjectName("GalleryItem")