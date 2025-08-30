from pathlib import Path
import configparser
from PySide6.QtCore import QObject, Signal

class ConfigManager(QObject):
    _instance = None
    
    download_directory_changed = Signal(str)
    settings_changed = Signal()
    
    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(ConfigManager, cls).__new__(cls)
        return cls._instance
    
    def __init__(self, config_file: str | Path = 'config.ini'):
        if hasattr(self, '_initialized'):
            return
        super().__init__()
        self.config = configparser.ConfigParser()
        self.config_file = Path(config_file)
        
        if not self.config_file.exists():
            self._create_default_config()
        
        self.config.read(self.config_file, encoding='utf-8')
        self._initialized = True
    
    def _create_default_config(self):
        self.config['Paths'] = {
            'download_directory': 'downloads'
        }
        self.config['Settings'] = {
            'default_theme': 'white',
            'thumbnail_quality': '90'
        }
        with open(self.config_file, 'w', encoding='utf-8') as f:
            self.config.write(f)
    
    def _save_config(self):
        with open(self.config_file, 'w', encoding='utf-8') as f:
            self.config.write(f)
    
    def get_theme(self) -> str:
        return self.config.get("Settings", "default_theme", fallback="dark")
    
    def get_download_directory(self) -> str:
        path_str = self.config.get('Paths', 'download_directory', fallback='downloads')
        path = Path(path_str)
        path.mkdir(parents=True, exist_ok=True)
        return path
    
    def get_thumbnail_quality(self) -> int:
        return self.config.getint('Settings', 'thumbnail_quility', fallback=90)
        
    def set_download_directory(self, path: str | Path) -> str:
        path = Path(path)
        self.config.set('Paths', 'download_directory', str(path))
        self._save_config()
        self.download_directory_changed.emit(path)
        self.settings_changed.emit()
    
    def set_thumbnail_quality(self, quality: int):
        quality = max(1, min(100, quality))
        self.config.set('Settings', 'thumbnail_quality', str(quality))
        self._save_config()
        self.settings_changed.emit()