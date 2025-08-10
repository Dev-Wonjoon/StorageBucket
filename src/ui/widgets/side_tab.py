from PySide6.QtWidgets import QWidget, QVBoxLayout, QPushButton, QButtonGroup, QSizePolicy, QSpacerItem
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QIcon


class SideTab(QWidget):
    currentChanged = Signal(int)
    
    def __init__(self, parent=None, fixed_width=200, spacing=8, margins=(12, 16, 12, 16)):
        super().__init__(parent)
        self.setObjectName("SideTab")
        self._buttons: list[QPushButton] = []
        
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(*margins)
        self._layout.setSpacing(spacing)
        
        self._group = QButtonGroup(self)
        self._group.setExclusive(True)
        self._group.idToggled.connect(self._on_id_toggled)
        
        self._spacer = QSpacerItem(0, 0, QSizePolicy.Minimum, QSizePolicy.Expanding)
        self._layout.addItem(self._spacer)
        
        if fixed_width:
            self.setFixedWidth(fixed_width)
    
    def addTab(self, text: str, icon: QIcon | None = None, data=None) -> int:
        btn = QPushButton(text)
        if icon:
            btn.setIcon(icon)
        btn.setCheckable(True)
        btn.setMinimumHeight(40)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        btn.setProperty("tabData", data)
        
        self._layout.removeItem(self._spacer)
        self._layout.addWidget(btn)
        self._layout.addItem(self._spacer)
        
        index = len(self._buttons)
        self._buttons.append(btn)
        self._group.addButton(btn, index)
        
        if index == 0:
            btn.setChecked(True)
            
        return index
    
    def insertTab(self, index: int, text: str, icon: QIcon | None = None, data=None) -> int:
        index = max(0, min(index, len(self._buttons)))
        btn = QPushButton(text)
        
        if icon:
            btn.setIcon(icon)
        
        btn.setCheckable(True)
        btn.setMinimumHeight(40)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        btn.setProperty("tabData", data)
        
        self._layout.removeItem(self._spacer)
        self._layout.insertWidget(index, btn)
        self._layout.addItem(self._spacer)
        
        for i, b in enumerate(self._buttons):
            self._group.removeButton(b)
        for i, b in enumerate(self._buttons):
            self._group.addButton(b, i)
        return index
    
    def removeTab(self, index: int) -> None:
        if 0 <= index < len(self._buttons):
            btn = self._buttons.pop(index)
            self._group.removeButton(btn)
            btn.setParent(None)
            
            for i, b in enumerate(self._buttons):
                self._group.removeButton(b)
            for i, b in enumerate(self._buttons):
                self._group.addButton(b, i)
            if self._buttons:
                self.setCurrentIndex(min(index, len(self._buttons) - 1))
    
    def setCurrentIndex(self, index: int) -> None:
        if 0 <= index < len(self._buttons):
            self._buttons[index].setChecked(True)
    
    def currentIndex(self) -> int:
        for i, b in enumerate(self._buttons):
            if b.isChecked():
                return i
        return -1

    def count(self) -> int:
        return len(self._buttons)
    
    def tabButton(self, index: int) -> QPushButton | None:
        if 0 <= index < len(self._buttons):
            return self._buttons[index]
        return None

    def tabData(self, index: int):
        btn = self.tabButton(index)
        return btn.property("tabData") if btn else None
    
    def _on_id_toggled(self, id_: int, checked: bool):
        if checked:
            self.currentChanged.emit(id_)
    