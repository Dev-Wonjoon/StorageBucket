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
        
        self.setCursor(QCursor(Qt.PointingHandCursor))
        
        main_layout= QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(4)
        
        self.thumbnail_label = QLabel()
        self.thumbnail_label.setScaledContents(True)
        self.set_thumbnail(item.thumbnail_path)
        
        info_widget = QWidget()
        info_layout = QVBoxLayout(info_widget)
        
        title_label = InfoLabel(
            text=item.title,
            color="#00BFFF",
            bold=True,
            elide=True,
            max_width=260
        )
        title_label.clicked.connect(lambda text: self.label_clicked.emit({"title", text}))
        
        platform_label = InfoLabel(
            text=item.platform_name or "Unknown",
            color="#FFD700",
        )
        platform_label.clicked.connect(lambda text: self.label_clicked.emit(("platform", text)))
        
        author_layout = QHBoxLayout()
        author_label = InfoLabel(
            text=item.profile_name or "Unknown",
            color="#AAAAAA"
        )
        author_label.clicked.connect(lambda text: self.label_clicked.emit("profile", text))
        
        
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
    
    def sizeHint(self):
        return QSize(300, 240)