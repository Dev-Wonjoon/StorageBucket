import logging, sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

def setup_logging():
    logger = logging.getLogger()
    logger.setLevel(logging.DEBUG)
    
    log_format = logging.Formatter(
        "%(asctime)s - %(levelname)-8s - %(name)s:%(lineno)d - %(message)s"
    )
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG)
    console_handler.setFormatter(log_format)
    logger.addHandler(console_handler)
    
    log_dir = Path(__file__).resolve().parents[2] / ".logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "sb.log"
    
    file_handler = RotatingFileHandler(
        log_file, maxBytes=5*1024*1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(log_format)
    logger.addHandler(file_handler)
    