from PySide6.QtWidgets import QWidget, QHBoxLayout
from common.components.styled_button.widget import StyledButton


class FilterBar(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._layout = QHBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.addSpacing(6)
    
    def update_tag(self, tags, callback):
        while self._layout.count():
            child = self._layout.takeAt(0)
            if child.widget():
                child.widget().setParent(None)
        
        for tag in tags:
            btn = StyledButton(text=tag)
            btn.setObjectName("FilterButton")
            btn.clicked.connect(lambda checked, t=tag: callback)
            self._layout.addWidget(btn)
        
        self._layout.addStretch()