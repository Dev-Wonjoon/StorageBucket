from PySide6.QtWidgets import QWidget, QHBoxLayout, QLabel, QSpacerItem, QSizePolicy, QLineEdit
from common.components.styled_button.widget import StyledButton


class MainTopBar(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.addSpacerItem(QSpacerItem(40, 20, QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum))
        self.theme_toggle_button = StyledButton(icon_path="sun-icon.png")
        layout.addWidget(self.theme_toggle_button)
        layout.addWidget(QLineEdit(placeholderText="Search..."))