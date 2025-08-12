import sys
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable
from PySide6.QtCore import QObject, QRunnable, Signal, Slot, QThreadPool


@dataclass
class Task:
    """
    스레드에서 실행할 작업의 모든 정보를 담는 객체
    - target: 실행할 함수
    - args, kwargs: 함수에 전달될 인자
    - on_success: 작업 성공 시 호출될 콜백 함수
    - on_error: 작업 실패 시 호출될 콜백 함수
    """
    
    target: Callable
    args: tuple = field(default_factory=tuple)
    kwargs: dict = field(default_factory=dict)
    on_success: Callable[[Any], None] = None
    on_error: Callable[[str], None] = None


class WorkerSignal(QObject):
    """
    Worker 스레드에서 발생할 시그널 정의
    """
    success = Signal(object, object)
    error = Signal(object, str)


class Worker(QRunnable):
    """
    작업 큐에서 실행하는 작업자
    """
    def __init__(self, task: Task):
        super().__init__()
        self.task = task
        self.signals = WorkerSignal()
    
    def run(self):
        try:
            result = self.task.target(*self.task.args, **self.task.kwargs)
            if self.task.on_success:
                self.signals.success.emit(self.task.on_success, result)
        except Exception as e:
            error_msg = f"{self.task.target.__name__} failed: {traceback.format_exc()}"
            if self.task.on_error:
                self.signals.error.emit(self.task.on_error, error_msg)


class ThreadPoolManager(QObject):
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.threadpool = QThreadPool()
            print(f"ThreadPoolManager initialized with {cls._instance.threadpool.maxThreadCount()} threads.")
        return cls._instance

    def submit(self, task: Task):
        """
        스레드 풀에 작업을 등록할 때 사용하는 함수
        """
        worker = Worker(task)
        worker.signals.success.connect(self._on_success)
        worker.signals.error.connect(self._on_error)
        self.threadpool.start(worker)
        
    def _on_success(self, callback: Callable, result: Any):
        if callback:
            callback(result)
    
    def _on_error(self, callback: Callable, error_msg: str):
        if callback:
            callback(error_msg)

thread_manager = ThreadPoolManager()