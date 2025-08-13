from PySide6.QtWidgets import QLineEdit, QWidget, QVBoxLayout, QLabel, QPushButton
from PySide6.QtCore import Signal
from PySide6.QtGui import QKeySequence, QKeyEvent, QGuiApplication

from src.controller.download_controller import DownloadController

class PasteDownloadLineEdit(QLineEdit):
    pasted = Signal(str)
    def keyPressEvent(self, event: QKeyEvent):
        if event.matches(QKeySequence.StandardKey.Paste):
            clip = (QGuiApplication.clipboard().text() or "").strip()
            if clip:
                self.setText(clip)
                self.pasted.emit(clip)
            return
        super().keyPressEvent(event)


class UrlInputBar(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.ctrl = DownloadController()
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        url_label = QLabel("Download URL: ")
        layout.addWidget(url_label)
        self.url_input = PasteDownloadLineEdit()
        self.url_input.setPlaceholderText("다운로드 할 URL을 입력하세요.")
        layout.addWidget(self.url_input)
        
        self.btn_download = QPushButton("Download")
        self.btn_download.setFixedHeight(40)
        layout.addWidget(self.btn_download)
        
        self.btn_download.clicked.connect(self._on_click)
        self.url_input.returnPressed.connect(self._on_click)
        self.url_input.pasted.connect(self._on_click)
        
    def _on_click(self, url: str = None):
        url = url or self.url_input.text()
        url = (url or "").strip()
        if not url:
            return
        self.ctrl.start_download(url)
        self.url_input.setText("")