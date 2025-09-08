from PySide6.QtWidgets import QMainWindow, QWidget, QHBoxLayout, QVBoxLayout
from screens.main_window.viewmodel import MainWindowViewModel
from common.components.main_window import MainLeftPanel, DownloadBar, FilterBar, MainTopBar, GalleryListWidget
from common.components.styled_button.widget import StyledButton

class MainWindow(QMainWindow):
    def __init__(self, view_model: MainWindowViewModel):
        super().__init__()
        self.vm = view_model
        self.setWindowTitle("Storage Bucket")
        self.resize(1440, 900)
        self.setObjectName("MainWindow")
        
        self._init_ui()
        self._connect_signals()
         
        self.vm.inital_load()
    
    def _init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        main_layout = QHBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        self.left_panel = MainLeftPanel()
        self.top_bar = MainTopBar()
        self.toggle_theme_button = self.top_bar.theme_toggle_button
        self.filter_bar = FilterBar()
        self.gallery_list = GalleryListWidget()
        self.download_bar = DownloadBar(self._on_download_clicked)
        
        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.addWidget(self.top_bar)
        right_layout.addWidget(self.filter_bar)
        right_layout.addWidget(self.gallery_list)
        right_layout.addWidget(self.download_bar)
        
        main_layout.addWidget(self.left_panel)
        main_layout.addWidget(right_panel)
    
    def _connect_signals(self):
        self.vm.media_items_changed.connect(self.gallery_list.update_items)
        self.vm.available_tags_changed.connect(
            lambda tags: self.filter_bar.update_tag(tags, self.vm.filter_by_tag)
        )
    
    def _on_download_clicked(self, url: str):
        self.vm.download_media(url)