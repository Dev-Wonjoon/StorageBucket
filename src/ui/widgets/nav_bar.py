from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QWidget, QHBoxLayout, QLabel, QToolButton, QSizePolicy, QSpacerItem


class NavBar(QWidget):
    theme_toggled = Signal(str)
    
    def __init__(self, title: str = "Storage Bucket", dark_enabled: bool = True, parent=None):
        super().__init__(parent)
        self.setObjectName("Navbar")
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 10, 16, 10)
        layout.setSpacing(10)
        
        self.titleLabel = QLabel(title, objectName="NavTitle")
        self.titleLabel.setStyleSheet("font-size:16px; font-weight:600;")
        layout.addWidget(self.titleLabel)
        
        layout.addItem(QSpacerItem(0, 0, QSizePolicy.Expanding, QSizePolicy.Minimum))
        
        self.btnTheme = QToolButton(self)
        self.btnTheme.setCheckable(True)
        self.btnTheme.setToolTip("다크 모드 전환")
        self.setDark(dark_enabled)
        self.btnTheme.clicked.connect(self._emit_theme_toggled)
        
        layout.addWidget(self.btnTheme)
    
    def setTitle(self, text: str):
        self.titleLabel.setText(text)
    
    def isDark(self) -> bool:
        return self.btnTheme.isChecked()
    
    def setDark(self, enabled: bool):
        self.btnTheme.setChecked(enabled)
        self.btnTheme.setText("Dark" if enabled else "Light")
    
    def _emit_theme_toggled(self):
        theme = "dark" if self.btnTheme.isChecked() else "light"
        self.btnTheme.setText("Dark" if theme == "dark" else "Light")
        self.theme_toggled.emit(theme)