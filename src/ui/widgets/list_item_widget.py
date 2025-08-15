from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QWidget, QHBoxLayout, QVBoxLayout, QLabel, QSpacerItem, QSizePolicy, QCheckBox

from src.database.models.media import Media


class ListItemWidget(QWidget):
    
    def __init__(self, media: Media, parent=None):
        super().__init__(parent)
        self.media = media
        
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(10, 5, 10, 5)
        main_layout.setSpacing(15)
        
        self.thumbnail_label = QLabel()
        self.thumbnail_label.setFixedSize(120, 80)
        self.thumbnail_label.setAlignment(Qt.AlignCenter)
        main_layout.addWidget(self.thumbnail_label)
        
        info_layout = QVBoxLayout()
        info_layout.setContentsMargins(0, 0, 0, 0)
        info_layout.setSpacing(2)
        
        self.title_label = QLabel(f"<b>{media.title or '제목 없음'}</b>")
        
        platform_name = media.platform.name.capitalize() if media.platform else "N/A"
        uploader_name = media.profile.owner_name if media.profile else "N/A"
        self.subtitle_label = QLabel(f"{platform_name} | {uploader_name}")
        
        info_layout.addWidget(self.title_label)
        info_layout.addWidget(self.subtitle_label)
        info_layout.addSpacerItem(QSpacerItem(0, 0, QSizePolicy.Minimum, QSizePolicy.Expanding))
        
        main_layout.addLayout(info_layout, 1)
        
        self.set_data(media)
        
        self.checkbox = QCheckBox(self)
        self.checkbox.hide()
        main_layout.addWidget(self.checkbox)
    
    def set_data(self, media: Media):
        if media.thumbnail_path:
            pixmap = QPixmap(media.thumbnail_path)
            scaled_pixmap = pixmap.scaled(self.thumbnail_label.size(),
                                          Qt.KeepAspectRatio,
                                          Qt.SmoothTransformation)
            self.thumbnail_label.setPixmap(scaled_pixmap)
        else:
            self.thumbnail_label.setText("No Img")
    
    def set_select_mode(self, enabled: bool):
        self.checkbox.setChecked(False)
        self.checkbox.setVisible(enabled)
        
    def is_checked(self) -> bool:
        return self.checkbox.isVisible() and self.checkbox.isChecked()