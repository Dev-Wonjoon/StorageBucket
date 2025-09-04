from PySide6.QtWidgets import QPushButton, QSizePolicy
from PySide6.QtGui import QIcon, QCursor
from PySide6.QtCore import QSize, Qt


class StyledButton(QPushButton):
    def __init__(self, text="", icon_path=None, tooltip=""):
        super().__init__(text)
        
        self.setObjectName("StyledButton")
        self.setCursor(QCursor(Qt.PointingHandCursor))
        
        if icon_path:
            self.setIcon(QIcon(icon_path))
            self.setIconSize(QSize(18, 18))
        
        if icon_path and not text:
            self.setObjectName("StyledIconButton")
            if tooltip:
                self.setToolTip(tooltip)
            
            self.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)