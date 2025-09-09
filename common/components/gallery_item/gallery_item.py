from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel
from PySide6.QtGui import QPixmap, QColor, QCursor
from PySide6.QtCore import Qt, Signal, QSize
from screens.main_window.model import MediaItem
from .info_label import InfoLabel


class GalleryItemWidget(QWidget):
    label_clicked = Signal(MediaItem)
    
    def __init__(self, item: MediaItem):
        super().__init__()
        self.item = item
        self.setObjectName("GalleryItem")
        self.setMaximumSize(self.sizeHint())
        
        self.setCursor(QCursor(Qt.CursorShape.PointingHandCursor))
        
        main_layout= QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(4)
        
        self.thumbnail_label = QLabel()
        self.thumbnail_label.setScaledContents(True)
        self.thumbnail_label.setMaximumHeight(180)
        self.set_thumbnail(item.thumbnail_path)
        
        info_widget = QWidget()
        info_layout = QVBoxLayout(info_widget)
        info_layout.setContentsMargins(6, 0, 6, 4)
        info_layout.setSpacing(2)
        
        title_label = InfoLabel(text=item.title)
        title_label.clicked.connect(lambda text: self.label_clicked.emit({"title", text}))
        
        platform_label = InfoLabel(text=item.platform_name or "Unknown",)
        platform_label.clicked.connect(lambda text: self.label_clicked.emit(("platform", text)))
        
        author_layout = QHBoxLayout()
        author_label = InfoLabel(text=item.profile_name or "Unknown",)
        author_label.clicked.connect(lambda text: self.label_clicked.emit("profile", text))
        
        
        author_layout.addWidget(author_label)
        
        info_layout.addWidget(title_label)
        info_layout.addWidget(platform_label)
        info_layout.addLayout(author_layout)
        
        main_layout.addWidget(self.thumbnail_label)
        main_layout.addWidget(info_widget)
        
    def set_thumbnail(self, path: str | None):
        pixmap = QPixmap(path)
        if pixmap.isNull():
            self.thumbnail_label.clear()
        else:
            self.thumbnail_label.setPixmap(pixmap)
    
    def sizeHint(self):
        return QSize(300, 270)