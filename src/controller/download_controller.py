from PySide6.QtCore import QObject, Signal
from typing import Optional
from uuid import uuid4

from src.services.thread_manager import Task, thread_manager
from src.database.repository import MediaRepository
from src.services.download_manager import DownloadManager, DownloadTask
from src.database.models.media_data import MediaData, MediaDataBuilder


class DownloadController(QObject):
    task_added = Signal(DownloadTask)
    task_progress = Signal(str, dict)
    task_error = Signal(str, str)
    task_finished = Signal(str, int)
    task_saved = Signal(str)

    def __init__(self, parent: Optional[QObject] = None):
        super().__init__(parent)
        self._manager = DownloadManager(self)
        self.media_repo = MediaRepository()
        self._manager.task_progress.connect(self.task_progress)
        self._manager.task_error.connect(self.task_error)
        self._manager.task_finished.connect(self.task_finished)
        self._manager.download_successed.connect(self.on_download_succeeded)

    def start_download(self, url: str) -> Optional[DownloadTask]:
        url = (url or "").strip()
        if not url:
            return None

        task = self._manager.start_download(url)
        if task:
            self.task_added.emit(task)
            return task
        else:
            self.task_error.emit(uuid4().hex[:12], "지원하지 않는 URL입니다.")
            return None

    def on_download_succeeded(self, task_id: str, metadata: dict):
        try:
            task_info = self._manager._tasks.get(task_id)
            if not task_info: return

            media_data = (MediaData.builder()
                          .with_dict(metadata)
                          .with_platform(task_info.source)
                          .build())
        except ValueError as e:
            self.task_error.emit(task_id, f"메타데이터 생성 실패: {e}")
            return

        # --- 수정된 부분: DB 저장 작업을 Repository 함수 호출로 변경 ---
        # 더 이상 로컬 엔진/세션을 만들지 않고, Repository에 작업을 위임합니다.
        def on_db_success(result):
            self.task_saved.emit(task_id)

        def on_db_error(error_msg: str):
            self.task_error.emit(task_id, f"DB 저장 실패: {error_msg}")
        
        db_task = Task(
            target=self.media_repo.create_with_relations, # Repository의 메서드를 직접 타겟으로 지정
            args=(media_data,),
            on_success=on_db_success,
            on_error=on_db_error,
        )
        thread_manager.submit(db_task)
        
    def cancel_download(self, task_id: str) -> bool:
        return self._manager.cancel_task(task_id)

    def cancel_all_downloads(self):
        self._manager.cancel_all_tasks()