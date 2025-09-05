from PySide6.QtWidgets import QLabel, QSizePolicy
from PySide6.QtGui import QFontMetrics
from PySide6.QtCore import Qt, Signal


class InfoLabel(QLabel):
    clicked = Signal(str)
    
    def __init__(self, text: str, bold: bool = False, elide: bool = False, max_width: int = 260):
        super().__init__()
        self._full_text = text
        self.max_width = max_width
        self.elide = elide
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)
        self.setWordWrap(False)
        self.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        
        if elide:
            fm = QFontMetrics(self.font())
            elided = fm.elidedText(self._full_text, Qt.TextElideMode.ElideRight, max_width)
            self.setText(elided)
            self.setToolTip(self._full_text)
        else:
            self.setText(self._full_text)
    
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self._full_text)
        super().mousePressEvent(event)