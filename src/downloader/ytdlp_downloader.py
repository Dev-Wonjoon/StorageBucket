from PySide6.QtCore import QObject, QProcess, Signal


class YtdlpDownloader(QObject):
    output = Signal(str)
    error = Signal(str)
    finished = Signal(int)
    
    