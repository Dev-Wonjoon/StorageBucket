from PySide6.QtWidgets import QPushButton, QSizePolicy
from PySide6.QtGui import QIcon, QCursor
from PySide6.QtCore import QSize, Qt
from core.config import ConfigManager


class StyledButton(QPushButton):
    def __init__(self, text="", icon_path=None, tooltip=""):
        super().__init__(text)
        self.config = ConfigManager()
        
        self.setObjectName("StyledButton")
        self.setCursor(QCursor(Qt.PointingHandCursor))
        
        if icon_path:
            full_icon_path = self.config.get_assets_path() / icon_path
            if full_icon_path.exists():
                self.setIcon(QIcon(str(full_icon_path)))
                self.setIconSize(QSize(24, 24))
        
        if icon_path and not text:
            self.setObjectName("StyledIconButton")
            if tooltip:
                self.setToolTip(tooltip)
            
            self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)