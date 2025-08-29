import sys
from PySide6.QtWidgets import QApplication

from screens.main_window import view


def main():
    
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()