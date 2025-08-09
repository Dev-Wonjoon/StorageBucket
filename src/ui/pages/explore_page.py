from PySide6.QtWidgets import QPushButton
from PySide6.QtGui import QIcon, QFont


class CommonButton(QPushButton):
    def __init__(
        self,
        text: str,
        icon_path: str = None,
        width: int = 120,
        height: int = 40,
        parent=None):
        super().__init__(text, parent)
        
        self.setFixedSize(text, parent)
        
        font = QFont()
        font.setPointSize(10)
        font.setBold(True)
        self.setFont(font)
        
        if icon_path:
            self.setIcon(QIcon(icon_path))
            self.setIconSize(self.size() * 0.8)
        
        self.setStyleSheet("""
            QPushButton {
                background-color: #3498db;
                color: white;
                border: none;
                
            }
            
            """)