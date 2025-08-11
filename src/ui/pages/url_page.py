from pathlib import Path
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QLineEdit, QPushButton, QTableWidget, QTableWidgetItem, QProgressBar
from PySide6.QtGui import QGuiApplication, QKeyEvent, QKeySequence
from PySide6.QtCore import Qt, Signal
from src.controller.ytdlp_controller import YtdlpController


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
        
        self.ctrl = YtdlpController()
        
        layout = QVBoxLayout(self)
        layout.addStretch(1)
        
        url_label = QLabel("Download URL: ")
        url_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(url_label)
        

        self.url_input = PasteDownloadLineEdit()
        self.url_input.setPlaceholderText("다운로드 할 URL을 입력")
        layout.addWidget(self.url_input, 1)
        
        btn_download = QPushButton("다운로드")
        btn_download.setFixedHeight(40)
        layout.addWidget(btn_download)
        
        self.table = QTableWidget(0, 5, self)
        self.table.setHorizontalHeaderLabels(["Task ID", "URL", "Progress", "Status", "Action"])
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setSelectionBehavior(self.table.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(self.table.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table, 1)
        
        layout.addStretch(1)
        layout.setAlignment(Qt.AlignHCenter)
        
        btn_download.clicked.connect(lambda: self._start(self.url_input.text().strip()))
        self.url_input.returnPressed.connect(lambda: self._start(self.url_input.text().strip()))
        self.url_input.pasted.connect(self._start)
        
    def _start(self, url: str):
        url = (url or "").strip()
        if not url:
            print("URL이 비어있습니다.")
            return
        try:
            task_id = self.ctrl.start(url)
            print(f"[등록] task_id={task_id}")
        except Exception as e:
            print(f"[ERR] 시작 실패: {e}")
    
    def _on_task_added(self, tid: str, url: str):
        row = self.table.rowCount()
        self.table.insertRow(row)
        self._task_row[tid] = row
        
        self.table.setItem(row, 0, QTableWidgetItem(tid))
        self.table.setItem(row, 1, QTableWidgetItem(url))
        
        bar = QProgressBar()
        bar.setRange(0, 100)
        bar.setValue(0)
        self.table.setCellWidget(row, 2, bar)
        self.table.setItem(row, 3, QTableWidgetItem("Queued"))
        
        btn = QPushButton("취소")
        btn.clicked.connect(lambda _, t=tid: self._cancel_task(t))
        
        self._row_widgets[tid] = {"bar": bar, "btn": btn}
    
    def _cancel_task(self, tid: str):
        if self.ctrl.cancel(tid):
            self._log(f"[취소 요청] {tid}")
    
    def _on_task_progress(self, tid: str, payload: dict):
        row = self._task_row.get(tid)
        if row is None:
            return
        bar = self._row_widgets[tid]["bar"]
        
        st = payload.get("status")
        if st == "downloading":
            total = payload.get("total_bytes") or 0
            done = payload.get("downloaded_bytes") or 0
            pct = int(done * 100 / total) if total else 0
            bar.setValue(pct)
            speed = payload.get("speed")
            eta = payload.get("eta")
            status_text = f"{pct}%"
            if speed: status_text += f" @ {self._pretty_speed(speed)}"
            if eta: status_text += f", ETA {eta}s"
            self.table.setItem(row, 3, QTableWidgetItem(status_text))
        elif st == "finished":
            bar.setValue(100)
            fn = payload.get("filename") or ""
            self.table.setItem(row, 3, QTableWidgetItem(f"Done: {Path(fn).name}"))
        
    def _on_task_finished(self, tid: str, code: int):
        row = self._task_row.get(tid)
        if row is None:
            return
        self._row_widgets[tid]["btn"].setEnabled(False)
        status = "Success" if code == 0 else f"Exit {code}"
        cur = self.table.item(row, 3)
        self.table.setItem(row, 3, QTableWidgetItem(status if cur is None else f"{cur.text()} | {status}"))
        self._log(f"[종료][{tid}] code={code}")
        
    def _pretty_speed(self, bps: float) -> str:
        try:
            units = ["B/s", "KB/s", "MB/s", "GB/s"]
            i = 0
            while bps >= 1024 and i < len(units)-1:
                bps /= 1024.0
                i += 1
            return f"{bps:.1f} {units[i]}"
        except Exception:
            return "-"
    
    def _log(self, msg: str):
        self.log.appendPlainText(msg)
        
        