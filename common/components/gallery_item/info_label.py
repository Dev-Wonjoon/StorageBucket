from PySide6.QtWidgets import QLabel, QSizePolicy
from PySide6.QtGui import QFontMetrics
from PySide6.QtCore import Qt, Signal


class InfoLabel(QLabel):
    clicked = Signal(str)
    
    def __init__(self, text: str, color: str = "#FFFFFF", bold: bool = False, elide: bool = False, max_width: int = 260):
        super().__init__()
        self._full_text = text
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self.setWordWrap(True)
        
        style = f"color: {color};"
        if bold:
            style += " font-weight: bold;"
        self.setStyleSheet(style)
        self.setCursor(Qt.PointingHandCursor)
        self.setMinimumHeight(self.fontMetrics().height() + 6)
        
        if elide:
            fm = QFontMetrics(self.font())
            elide_text = fm.elidedText(text, Qt.TextElideMode.ElideRight, max_width)
            self.setText(elide_text)
            self.setToolTip(text)
        else:
            self.setText(text)
    
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self._full_text)