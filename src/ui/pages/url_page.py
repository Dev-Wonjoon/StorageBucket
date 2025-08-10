from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QLineEdit, QPushButton, QHBoxLayout
from PySide6.QtGui import QGuiApplication
from PySide6.QtCore import Qt


class UrlWidget(QWidget):
    def __init__(self):
        super().__init__()
        
        layout = QVBoxLayout(self)
        layout.addStretch(1)
        
        url_label = QLabel("Download URL: ")
        url_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(url_label)
        
        self.url_input = QLineEdit()
        layout.addWidget(self.url_input, 1)
        
        btn_download = QPushButton("다운로드")
        btn_download.setFixedHeight(40)
        layout.addWidget(btn_download)
        layout.addStretch(1)
        layout.setAlignment(Qt.AlignHCenter)