import os, sys, json
from PySide6.QtCore import Signal, QProcess, QObject, QProcessEnvironment
from src.core.config import Config

class YtdlpProcess(QObject):
    progress = Signal(dict)
    finished = Signal(int)
    line_out = Signal(str)
    line_err = Signal(str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._proc: QProcess | None = None
    
    def is_running(self) -> bool:
        return self._proc is not None
    
    def start(self, url: str, *, outtmpl: str = None,
              fmt: str = "bestvideo+bestaudio/best",
              ffmpeg_location: str | None = None,
              cookies: str | None = None,
              allow_playlist: bool = False,
              workdir: str | None = None):
        if self._proc:
            return
        self._proc = QProcess(self)
        if workdir:
            self._proc.setWorkingDirectory(workdir)
        
        opts = []
        if outtmpl:
            opts += ["--outtmpl", outtmpl]
        opts += ["--format", fmt]
        if ffmpeg_location:
            opts += ["--ffmpeg-location", ffmpeg_location]
        if cookies:
            opts += ["--cookies", cookies]
        if allow_playlist:
            opts += ["--playlist"]
        
        if getattr(sys, "frozen", False):
            program = sys.executable
            args = ["--ytdlp-worker", url, *opts]
        else:
            program = sys.executable
            args = ["-m", "src.workers.ytdlp_worker", url, *opts]
            env = QProcessEnvironment.systemEnvironment()
            env.insert("PYTHONPATH", str(Config.base_dir()))
            self._proc.setProcessEnvironment(env)
        
        self._proc.readyReadStandardOutput.connect(self._on_stdout)
        self._proc.readyReadStandardError.connect(self._on_stderr)
        self._proc.finished.connect(self._on_finished)
        
        self._proc.start(sys.executable, opts)
    
    def kill(self):
        if self._proc:
            self._proc.kill()
            
    
    def _on_stdout(self):
        if not self._proc:
            return
        data = self._proc.readAllStandardOutput()
        text = bytes(data).decode("utf-8", errors="replace")
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            self.line_out.emit(line)
            if line.startswith("PROGRESS "):
                try:
                    payload = json.loads(line[len("PROGRESS "):])
                    self.progress.emit(payload)
                except Exception:
                    pass
    
    
    def _on_stderr(self):
        if not self._proc:
            return
        data = self._proc.readAllStandardError()
        text = bytes(data).decode("utf-8", errors="replace")
        for line in text.splitlines():
            line = line.strip()
            if line:
                self.line_err.emit(line)
    
    def _on_finished(self, exit_code, _status):
        self.finished.emit(int(exit_code))
        self._proc = None
        
