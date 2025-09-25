import logging

from PySide6.QtWidgets import QWidget, QHBoxLayout, QSpacerItem, QSizePolicy, QLineEdit, QFileDialog
from PySide6.QtCore import Signal
from common.components.styled_button.widget import StyledButton
from database.repository.media_repository import MediaRepository

logger = logging.getLogger(__name__)

class MainTopBar(QWidget):
    files_selected = Signal(list)
    def __init__(self, parent=None):
        super().__init__(parent)
        
        layout = QHBoxLayout(self)
        self.add_media_button = StyledButton(icon_path="media_add.png", tooltip="Add local image")
        self.add_media_button.clicked.connect(self.open_file_dialog)
        layout.addWidget(self.add_media_button)
        layout.addSpacerItem(QSpacerItem(40, 20, QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum))
        self.theme_toggle_button = StyledButton(icon_path="sun-icon.png")
        layout.addWidget(self.theme_toggle_button)
        layout.addWidget(QLineEdit(placeholderText="Search..."))
    
    def open_file_dialog(self):
        file_paths, _ = QFileDialog.getOpenFileNames(
            self,
            "이미지 선택",
            "",
            "Media files (*.png *.jpg *.jpeg *.webp *.mp4 *.avi *.mkv *.mov);;All Files (*)"
        )
        
        if file_paths:
            logger.info(f"선택된 파일: {file_paths}")
            self.files_selected.emit(file_paths)
        
        return file_paths