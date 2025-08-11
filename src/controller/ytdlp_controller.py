from PySide6.QtCore import QObject, Signal, Slot
from typing import Optional, Dict
from uuid import uuid4
from src.core.config import Config
from src.services.ytdlp_process import YtdlpProcess


class YtdlpController(QObject):
    worker_name = "ytdlp_worker.py"
    task_added = Signal(str, str)
    task_started = Signal(str, str)
    task_progress = Signal(str, dict)
    task_message = Signal(str, str)
    task_error = Signal(str, str)
    task_finished = Signal(str, int)
    
    def __init__(self, parent: Optional[QObject] = None):
        super().__init__(parent)
        self._worker_path = str(Config.workers_dir() / self.worker_name)
        self._running: Dict[str, YtdlpProcess] = {}
    
    
    def start(self, url: str, **opts) -> str:
        url = (url or "").strip()
        task_id = uuid4().hex[:12]
        
        self.task_added.emit(task_id, url)
        proc = YtdlpProcess(self)
        
        proc.progress.connect(lambda payload, tid=task_id: self.task_progress.emit(tid, payload))
        proc.line_out.connect(lambda line, tid=task_id: self.task_message.emit(tid, line))
        proc.line_err.connect(lambda line, tid=task_id: self.task_error.emit(tid, line))
        proc.finished.connect(lambda code, tid=task_id: self._on_finished(tid, code))
        
        self._running[task_id] = proc
        self.task_started.emit(task_id, url)
        
        proc.start(url, **opts)
        return task_id
    
    def cancel(self, task_id: str) -> bool:
        proc = self._running.get(task_id)
        if not proc:
            return False
        proc.kill()
        return True

    def cancel_all(self):
        for proc in list(self._running.values()):
            proc.kill()
    
    def is_running(self, task_id: Optional[str] = None) -> bool:
        if task_id is None:
            return bool(self._running)
        return task_id in self._running
    
    def running_ids(self) -> list[str]:
        return list(self._running.keys())
    
    def _on_finished(self, task_id: str, exit_code: int):
        self._running.pop(task_id, None)
        self.task_finished.emit(task_id, int(exit_code))