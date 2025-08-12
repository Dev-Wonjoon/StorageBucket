from pathlib import Path
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QLabel, QLineEdit,
                               QPushButton, QTableWidget, QTableWidgetItem, QProgressBar)
from PySide6.QtGui import QGuiApplication, QKeyEvent, QKeySequence
from PySide6.QtCore import Qt, Signal
from src.controller.download_controller import DownloadController, DownloadTask
import logging


class PasteDownloadLineEdit(QLineEdit):
    pasted = Signal(str)
    def keyPressEvent(self, event: QKeyEvent):
        if event.matches(QKeySequence.StandardKey.Paste):
            clip = (QGuiApplication.clipboard().text() or "").strip()
            if clip:
                self.setText(clip)
                self.pasted.emit(clip)
            return
        super().keyPressEvent(event)


class UrlWidget(QWidget):
    def __init__(self):
        super().__init__()

        self.ctrl = DownloadController()
        self._task_row = {}
        self._row_widgets = {}

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 20, 20, 20)

        url_label = QLabel("Download URL:")
        layout.addWidget(url_label)

        self.url_input = PasteDownloadLineEdit()
        self.url_input.setPlaceholderText("다운로드 할 URL을 입력 (YouTube, Instagram 등)")
        layout.addWidget(self.url_input)

        btn_download = QPushButton("다운로드")
        btn_download.setFixedHeight(40)
        layout.addWidget(btn_download)

        self.table = QTableWidget(0, 6, self)
        self.table.setHorizontalHeaderLabels(["Task ID", "Source", "URL", "Progress", "Status", "Action"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setSelectionBehavior(self.table.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(self.table.EditTrigger.NoEditTriggers)
        
        self.table.setColumnWidth(0, 100)
        self.table.setColumnWidth(1, 80)
        self.table.setColumnWidth(2, 250)
        self.table.setColumnWidth(4, 150)
        layout.addWidget(self.table, 1)

        btn_download.clicked.connect(lambda: self._start_download(self.url_input.text()))
        self.url_input.returnPressed.connect(lambda: self._start_download(self.url_input.text()))
        self.url_input.pasted.connect(self._start_download)

        self.ctrl.task_added.connect(self._on_task_added)
        self.ctrl.task_progress.connect(self._on_task_progress)
        self.ctrl.task_error.connect(self._on_task_error)
        self.ctrl.task_finished.connect(self._on_task_finished)
        self.ctrl.task_saved.connect(self._on_task_saved)


    def _start_download(self, url: str):
        url = (url or "").strip()
        if not url:
            self._log("URL이 비어있습니다.", level="warning")
            return

        task = self.ctrl.start_download(url)
        if task:
            self._log(f"[등록] Task ID: {task.id}, Source: {task.source}")
        else:
            self._log(f"[오류] 지원하지 않는 URL이거나 시작에 실패했습니다: {url}", level="error")

    def _on_task_added(self, task: DownloadTask):
        row = self.table.rowCount()
        self.table.insertRow(row)
        self._task_row[task.id] = row

        self.table.setItem(row, 0, QTableWidgetItem(task.id))
        self.table.setItem(row, 1, QTableWidgetItem(task.source))
        self.table.setItem(row, 2, QTableWidgetItem(task.url))

        bar = QProgressBar()
        bar.setRange(0, 100)
        bar.setValue(0)
        self.table.setCellWidget(row, 3, bar)
        self.table.setItem(row, 4, QTableWidgetItem("Queued"))

        btn = QPushButton("취소")
        btn.clicked.connect(lambda _, t=task.id: self._cancel_task(t))
        self.table.setCellWidget(row, 5, btn)

        self._row_widgets[task.id] = {"bar": bar, "btn": btn}

    def _cancel_task(self, tid: str):
        if self.ctrl.cancel_download(tid):
            self._log(f"[취소 요청] {tid}")
            row = self._task_row.get(tid)
            if row is not None:
                self.table.item(row, 4).setText("Cancelling...")

    def _on_task_progress(self, tid: str, payload: dict):
        row = self._task_row.get(tid)
        if row is None: return

        bar = self._row_widgets[tid]["bar"]
        status_item = self.table.item(row, 4)
        st = payload.get("status")

        if st == "downloading":
            total = payload.get("total_bytes") or payload.get("total_bytes_estimate") or 0
            done = payload.get("downloaded_bytes") or 0
            pct = int(done * 100 / total) if total else 0
            bar.setValue(pct)

            speed = payload.get("speed")
            eta = payload.get("eta")
            status_text = f"{pct}%"
            if speed: status_text += f" @ {self._pretty_speed(speed)}"
            if eta: status_text += f", ETA: {eta}s"
            status_item.setText(status_text)

        elif st == "finished":
            bar.setValue(100)
            fn = payload.get("filename") or "Unknown"
            status_item.setText(f"완료: {Path(fn).name}")

    def _on_task_error(self, tid: str, error_msg: str):
        self._log(f"[오류][{tid}] {error_msg}", level="error")
        row = self._task_row.get(tid)
        if row is None: return

        self.table.item(row, 4).setText(f"오류")
        self._row_widgets[tid]["btn"].setEnabled(False)

    def _on_task_finished(self, tid: str, code: int):
        self._log(f"[종료][{tid}] Exit Code: {code}")
        row = self._task_row.get(tid)
        if row is None: return

        self._row_widgets[tid]["btn"].setEnabled(False)

        status = "성공" if code == 0 else f"실패 (코드: {code})"
        current_status_item = self.table.item(row, 4)

        if "오류" not in current_status_item.text():
             current_status_item.setText(status)
             if code == 0:
                 current_status_item.setText("Saving to DB...")

    def _on_task_saved(self, tid: str):
        self._log(f"[DB 저장 완료] {tid}")
        row = self._task_row.get(tid)
        if row is None: return

        status_item = self.table.item(row, 4)
        status_item.setText("저장 완료")

    def _pretty_speed(self, bps: float) -> str:
        if not isinstance(bps, (int, float)) or bps <= 0:
            return ""
        try:
            units = ["B/s", "KB/s", "MB/s", "GB/s"]
            i = 0
            while bps >= 1024 and i < len(units)-1:
                bps /= 1024.0
                i += 1
            return f"{bps:.1f} {units[i]}"
        except Exception:
            return "-"

    def _log(self, msg: str, level="info"):
        print(f"[{level.upper()}] {msg}")