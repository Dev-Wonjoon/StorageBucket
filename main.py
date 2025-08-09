import sys
from PySide6.QtWidgets import QApplication

from src.database.settings import init_db
from src.ui.pages.main_window import MainWindow


def main():
    engine = init_db()
    
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()