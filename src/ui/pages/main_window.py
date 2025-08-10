from pathlib import Path
from PySide6.QtWidgets import QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QStackedWidget, QLabel
from PySide6.QtGui import QGuiApplication
from PySide6.QtCore import Qt, QSettings


from src.ui.widgets.side_tab import SideTab
from src.ui.widgets.nav_bar import NavBar
from .url_page import UrlWidget


APP_ORG = "StorageBucket"
APP_NAME = "StorageBucketApp"
THEME_KEY = "dark"

def load_qss(theme_name: str) -> str:
    styles_dir = Path(__file__).parent.parent / "styles"
    qss_path = styles_dir / f"{theme_name}.qss"
    return qss_path.read_text(encoding="utf-8")


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Storage Bucket")
        
        screen_size = QGuiApplication.primaryScreen().availableGeometry()
        width = int(screen_size.width() * 0.45)
        height = int(screen_size.height() * 0.50)
        self.resize(width, height)
        
        root = QWidget()
        self.setCentralWidget(root)
        main_layout = QVBoxLayout(root)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        settings = QSettings(APP_ORG, APP_NAME)
        saved_theme = settings.value(THEME_KEY, "dark", type=str)
        
        self.navbar = NavBar(title="Storage Bucket", dark_enabled=(saved_theme == "dark"))
        self.navbar.theme_toggled.connect(self.apply_theme_and_save)
        main_layout.addWidget(self.navbar)
        
        content_layout = QHBoxLayout()
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(0)
        main_layout.addLayout(content_layout, 1)
        
        self.sidebar = SideTab(fixed_width=200)
        url_idx = self.sidebar.addTab("다운로드")
        list_idx = self.sidebar.addTab("목록 보기")
        content_layout.addWidget(self.sidebar)
        
        self.stack = QStackedWidget()
        content_layout.addWidget(self.stack, 1)
        
        self.url_page = UrlWidget()
        self.stack.addWidget(self.url_page)
        
        self.sidebar.currentChanged.connect(self.stack.setCurrentIndex)
        self.sidebar.setCurrentIndex(url_idx)
        
        self.apply_theme(saved_theme)
    
    def _make_placeholder(self, text: str) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        lbl = QLabel(text)
        lbl.setAlignment(Qt.AlignCenter)
        v.addWidget(lbl, 1)
        return w
    
    def apply_theme_and_save(self, theme: str):
        self.apply_theme(theme)
        QSettings(APP_ORG, APP_NAME).setValue(THEME_KEY, theme)
    
    def apply_theme(self, theme: str):
        qss = load_qss("dark" if theme == "dark" else "light")
        self.qApp().setStyleSheet(qss)
        
    def qApp(self):
        from PySide6.QtWidgets import QApplication
        return QApplication.instance()