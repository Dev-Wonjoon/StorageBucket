from PySide6.QtCore import Signal
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLineEdit, QComboBox, QPushButton, QFormLayout
from common.components.styled_button.widget import StyledButton
from database.repository.media_search_repository import MediaSearchRepository


class SearchWidget(QWidget):
    search_requested = Signal(list)
    def __init__(self, search_repo: MediaSearchRepository, parent=None):
        super().__init__(parent)
        self.search_repo = search_repo
        
        layout = QFormLayout(self)
        
        self.title_edit = QLineEdit()
        self.title_op = QComboBox()
        self.title_op.addItems(["AND", "OR"])
        
        self.tag_edit = QLineEdit()
        self.tag_op = QComboBox()
        self.tag_op.addItems(["AND", "OR"])
        
        self.profile_edit = QLineEdit()
        self.profile_op = QComboBox()
        self.profile_op.addItems(["AND", "OR"])
        
        self.platform_edit = QLineEdit()
        self.platform_op = QComboBox()
        self.platform_op.addItems(["AND", "OR"])
        
        self.search_btn = StyledButton("검색")
        self.search_btn.clicked.connect(self.on_search)
        
        layout.addRow("제목", self.title_edit)
        layout.addRow("제목 조건", self.title_op)
        layout.addRow("태그", self.tag_edit)
        layout.addRow("태그 조건", self.tag_op)
        layout.addRow("프로필", self.profile_edit)
        layout.addRow("프로필 조건", self.profile_op)
        layout.addRow("플랫폼", self.platform_edit)
        layout.addRow("플랫폼 조건", self.platform_op)
        layout.addRow(self.search_btn)
        
    def on_search(self):
        filters = [
            ("title", self.title_edit.text(), self.title_edit, self.title_op.currentText()),
            ("tag", self.tag_edit.text(), self.tag_edit, self.tag_op.currentText()),
            ("profile", self.profile_edit.text(), self.profile_op.currentText()),
            ("platform", self.platform_edit.text(), self.platform_op.currentText()),
        ]
        
        results = self.search_repo.search(filters)
        self.search_requested.emit(filters)