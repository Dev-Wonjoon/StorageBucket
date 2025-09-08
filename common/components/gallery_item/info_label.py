from PySide6.QtWidgets import QLabel, QSizePolicy
from PySide6.QtGui import QFontMetrics, QResizeEvent
from PySide6.QtCore import Qt, Signal, QSize


class InfoLabel(QLabel):
    clicked = Signal(str)
    
    def __init__(self, text: str, bold: bool = False, max_width: int = 260, parent=None):
        super().__init__(parent)
        self._full_text = ""
        self.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        
        if bold:
            font = self.font()
            font.setBold(True)
            self.setFont(font)
            
        self.setText(text)
    
    def setText(self, text: str):
        self._full_text = text
        self.setToolTip(self._full_text)
        
        metrics = QFontMetrics(self.font())
        elided_text = metrics.elidedText(self._full_text, Qt.TextElideMode.ElideRight, self.width() - 5)
        super().setText(elided_text)
    
    def text(self) -> str:
        return self._full_text
    
    def resizeEvent(self, event: QResizeEvent) -> None:
        super().resizeEvent(event)
        self.setText(self._full_text)
    
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self._text)
        super().mousePressEvent(event)