from PySide6.QtWidgets import QWidget, QHBoxLayout, QLineEdit
from common.components.styled_button.widget import StyledButton


class DownloadBar(QWidget):
    def __init__(self, on_download, parent=None):
        super().__init__(parent)
        _layout = QHBoxLayout(self)
        _layout.setContentsMargins(6, 6, 6, 6)
        
        self.input = QLineEdit(placeholderText="Enter URL to download...")
        self.button = StyledButton(text="Download")
        
        _layout.addWidget(self.input, 1)
        _layout.addWidget(self.button)
        
        self.button.clicked.connect(self._handle_download)
        self._on_download = on_download
        
    def _handle_download(self):
        url = self.input.text().strip()
        if url:
            self._on_download(url)
            self.input.clear()