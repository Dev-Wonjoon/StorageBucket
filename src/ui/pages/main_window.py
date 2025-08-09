from PySide6.QtWidgets import QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QStackedWidget
from PySide6.QtGui import QGuiApplication

from .url_page import UrlWidget


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Storage Bucket")
        
        screen_size = QGuiApplication.primaryScreen().availableGeometry()
        width = int(screen_size.width() * 0.45)
        height = int(screen_size.height() * 0.50)
        self.resize(width, height)
        
        container = QWidget()
        self.setCentralWidget(container)
        main_layout = QVBoxLayout(container)
        
        nav_layout = QHBoxLayout()
        self.btn_url = QPushButton("URL")
        self.btn_list = QPushButton("목록 보기")
        
        nav_layout.addWidget(self.btn_url)
        nav_layout.addWidget(self.btn_list)
        main_layout.addLayout(nav_layout)
        
        self.stack = QStackedWidget(container)
        self.url_page = UrlWidget()
        
        self.stack.addWidget(self.url_page)
        main_layout.addWidget(self.stack)
        