import sys, logging
from core.app import App

def main():
    try:
        app_instance = App()
        sys.exit(app_instance.run())
    except Exception as e:
        logging.getLogger(__name__).critical(f"애플리케이션 실행 중 오류 발생: {e}", exc_info=True)
        sys.exit(1)
    

if __name__ == "__main__":
    main()