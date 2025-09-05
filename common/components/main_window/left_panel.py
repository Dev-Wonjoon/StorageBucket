from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel
from common.components.styled_button.widget import StyledButton

class MainLeftPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("MainLeftPanel")
        self.setFixedWidth(240)
        
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Stoage Bucket", objectName="LogoLabel"))
        # layout.addWidget(StyledButton(text="Feed"))
        # layout.addWidget(StyledButton(text="Search"))
        # layout.addWidget(StyledButton(text="Album"))
        layout.addStretch()
        
        self.theme_toggle_button = StyledButton(text="Toggle Theme")
        layout.addWidget(self.theme_toggle_button)
        layout.addWidget(StyledButton(text="Settings"))
        