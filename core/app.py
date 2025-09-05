import sys, logging
from pathlib import Path
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QFont

from .config import ConfigManager
from .database import init_db
from database.repository.media_repository import MediaRepository
from database.repository.tag_repository import TagRepository
from database.repository.platform_repository import PlatformRepository
from services.media_service import MediaService
from services.media_service import MediaService
from screens.main_window.viewmodel import MainWindowViewModel
from screens.main_window.view import MainWindow

logger = logging.getLogger(__name__)

class App:
    def __init__(self):
        self.app = QApplication(sys.argv)
        self._setup_logging()
        self._setup_font()
        self.config = self._setup_config()
        
        
        init_db()
        
        self._load_stylesheet()
        self.config.theme_changed.connect(self._load_stylesheet)
        
        tag_repo = TagRepository()
        media_repo = MediaRepository()
        platform_repo = PlatformRepository()
        media_service = MediaService(media_repo, tag_repo, platform_repo, self.config)
        main_vm = MainWindowViewModel(media_service)
        
        self.main_window = MainWindow(main_vm)
        self.main_window.toggle_theme_button.clicked.connect(self.toggle_theme)
        
    
    def _setup_logging(self):
        logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        logger.info("로깅 시스템을 초기화합니다.")
    
    def _setup_config(self) -> ConfigManager:
        logger.info("설정 관리자를 초기화합니다.")
        return ConfigManager(config_file='resource/config.ini')
    
    def _load_stylesheet(self):
        theme = self.config.get_theme()
        style_file = Path(f'resource/styles/style_{theme}.qss')
        if style_file.exists():
            logger.info(f"'{theme}' 스타일 시트를 로드합니다.")
            with style_file.open('r', encoding='utf-8') as f:
                self.app.setStyleSheet(f.read())
        else:
            logger.warning(f"테마 파일을 찾을 수 없습니다. '{style_file}'")

    def _setup_font(self):
        font = QFont("Segoe UI", 10)
        self.app.setFont(font)
        
    def toggle_theme(self):
        current_theme = self.config.get_theme()
        new_theme = 'light' if current_theme == 'dark' else 'dark'
        self.config.set_theme(new_theme)
    
    def run(self):
        logger.info("애플리케이션 시작")
        self.main_window.show()
        return self.app.exec()