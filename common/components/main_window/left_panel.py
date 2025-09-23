from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel
from common.components.styled_button.widget import StyledButton

class MainLeftPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        
        
        self.setObjectName("leftPanel")
        self.setMinimumWidth(80)
        
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Stoage Bucket", objectName="LogoLabel"))
        layout.addWidget(StyledButton(icon_path="search-icon.png"))
        layout.addWidget(StyledButton(text="Album"))
        layout.addStretch()
        layout.addWidget(StyledButton(icon_path="setting-icon.png"))
        