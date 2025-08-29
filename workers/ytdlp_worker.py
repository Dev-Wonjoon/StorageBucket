import yt_dlp
from .base_worker import BaseDownloadWorker
from .data_model import DownloadMediaInfo
from ..core.config import ConfigManager


class YtdlpWorker(BaseDownloadWorker):
    def run(self):
        