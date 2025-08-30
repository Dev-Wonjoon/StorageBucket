from PySide6.QtWidgets import QMainWindow, QWidget, QHBoxLayout, QVBoxLayout, QLabel, QListWidget, QSpacerItem, QSizePolicy, QLineEdit, QListWidgetItem, QListView
from PySide6.QtCore import Slot
from screens.main_window.viewmodel import MainWindowViewModel
from common.components.gallery_item.widget import GalleryItemWidget
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
        
        left_panel = self._create_left_panel()
        
        right_panel = self._create_right_panel()
        
        main_layout.addWidget(left_panel)
        main_layout.addWidget(right_panel, 1)
    
    def _create_left_panel(self):
        panel = QWidget()
        panel.setObjectName("LeftPanel")
        panel.setFixedWidth(240)
        layout = QVBoxLayout(panel)
        
        layout.addWidget(QLabel("Storage Bucket", objectName="LogoLabel"))
        layout.addWidget(StyledButton(text="DashBoard"))
        layout.addWidget(StyledButton(text="Feed"))
        layout.addWidget(StyledButton(text="Search"))
        layout.addWidget(StyledButton(text="Album"))
        layout.addStretch()
        layout.addWidget(StyledButton(text="Settings"))
        
        return panel
    
    def _create_right_panel(self):
        panel = QWidget()
        panel.setObjectName("RightPanel")
        layout = QVBoxLayout(panel)
        
        top_bar_layout = self._create_top_bar()
        
        self.filter_bar = QWidget()
        self.filter_bar_layout = QHBoxLayout(self.filter_bar)
        self.filter_bar_layout.setContentsMargins(0, 0, 0, 0)
        self.filter_bar_layout.addSpacing(6)
        
        self.gallery_list = QListWidget()
        self.gallery_list.setViewMode(QListWidget.ViewMode.IconMode)
        self.gallery_list.setResizeMode(QListView.Adjust)
        self.gallery_list.setMovement(QListWidget.Movement.Static)
        self.gallery_list.setSpacing(20)
        
        layout.addLayout(top_bar_layout)
        layout.addWidget(self.filter_bar)
        layout.addWidget(self.gallery_list, 1)
        return panel
    
    def _create_top_bar(self):
        layout = QHBoxLayout()
        layout.addWidget(QLabel("Dashboard", objectName="TitleLabel"))
        layout.addSpacerItem(QSpacerItem(40, 20, QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum))
        
        layout.addWidget(StyledButton(text="Feed"))
        layout.addWidget(StyledButton(text="Edit"))
        layout.addWidget(QLineEdit(placeholderText="Search..."))
        return layout
    
    def _connect_signals(self):
        self.vm.media_items_changed.connect(self.update_gallery)
        self.vm.available_tags_changed.connect(self.update_filter_tags)
        
    @Slot(list)
    def update_filter_tags(self, tags: list):
        while self.filter_bar_layout.count():
            child = self.filter_bar_layout.takeAt(0)
            if child.widget():
                child.widget().setParent(None)
        
        for tag_name in tags:
            btn = StyledButton(text=tag_name)
            btn.setObjectName("FilterButton")
            btn.clicked.connect(lambda checked, t=tag_name: self.vm.filter_by_tag(t))
            self.filter_bar_layout.addWidget(btn)
        self.filter_bar_layout.addStretch()
            
            
        
    @Slot(list)
    def update_gallery(self, media_items: list):
        self.gallery_list.clear()
        for item_data in media_items:
            list_item = QListWidgetItem(self.gallery_list)
            custom_widget = GalleryItemWidget(item_data)
            list_item.setSizeHint(custom_widget.sizeHint())
            self.gallery_list.addItem(list_item)
            self.gallery_list.setItemWidget(list_item, custom_widget)