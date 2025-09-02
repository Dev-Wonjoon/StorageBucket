from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QHBoxLayout
from PySide6.QtGui import QPixmap, QColor, QCursor
from PySide6.QtCore import Qt, Signal
from screens.main_window.model import MediaItem


class GalleryItemWidget(QWidget):
    clicked = Signal(MediaItem)
    
    def __init__(self, item: MediaItem):
        super().__init__()
        self.item = item
        self.setFixedSize(280, 240)
        self.setObjectName("GalleryItem")
        
        self.setCursor(QCursor(Qt.PointingHandCursor))
        
        main_layout= QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(4)
        
        self.thumbnail_label = QLabel()
        self.thumbnail_label.setObjectName("ThumbnailLabel")
        self.thumbnail_label.setScaledContents(True)
        self.set_thumbnail(item.thumbnail_path)
        
        info_widget = QWidget()
        info_widget.setObjectName("InfoOverlay")
        info_layout = QVBoxLayout(info_widget)
        info_layout.setContentsMargins(6, 4, 6, 4)
        info_layout.setSpacing(2)
        
        title_label = QLabel(item.title)
        title_label.setObjectName("TitleLabel")
        title_label.setStyleSheet("color: #00BFFF; font-weight: bold;")
        
        platform_label = QLabel(item.platform_name or "Unknown")
        platform_label.setObjectName("PlatformLabel")
        platform_label.setStyleSheet("color: #FFD700")
        
        author_layout = QHBoxLayout()
        author_label = QLabel(item.profile_name or "Unknown")
        author_label.setObjectName("AuthorLabel")
        
        
        author_layout.addWidget(author_label)
        author_layout.addStretch()
        
        info_layout.addWidget(title_label)
        info_layout.addWidget(platform_label)
        info_layout.addLayout(author_layout)
        
        main_layout.addWidget(self.thumbnail_label, 1)
        main_layout.addWidget(info_widget)
        
    def set_thumbnail(self, path):
        pixmap = QPixmap(path)
        if pixmap.isNull():
            pixmap = QPixmap(self.sizeHint().width(), 180)
            pixmap.fill(QColor('#444'))
        self.thumbnail_label.setPixmap(pixmap)