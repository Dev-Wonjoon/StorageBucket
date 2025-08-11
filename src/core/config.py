import json, sys
from pathlib import Path


def _app_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]

BASE_DIR: Path = _app_base_dir()
SRC_DIR: Path = BASE_DIR / "src"


class Config:
    
    CONFIG_DIR = BASE_DIR / ".config" / "StorageBucket"
    CONFIG_FILE = CONFIG_DIR / "settings.json"
    
    DEFAULTS = {
        "database_type": "sqlite",
        "database_name": "bucket.db",
        "project_root": str(BASE_DIR),
        "download_dir": str(BASE_DIR / "downloads"),
    }
    
    @classmethod
    def _load(cls) -> dict:
        if not cls.CONFIG_FILE.exists():
            return cls.DEFAULTS.copy()
        try:
            data = json.loads(cls.CONFIG_FILE.read_text(encoding="utf-8"))
            return {**cls.DEFAULTS, **data}
        except json.JSONDecodeError:
            return cls.DEFAULTS.copy()
    
    @classmethod
    def _save(cls, data: dict) -> None:
        cls.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        cls.CONFIG_FILE.write_text(
            json.dumps(data, indent=4, ensure_ascii=False),
            encoding="utf-8"
        )
    
    @classmethod
    def database_type(cls) -> str:
        return cls._load()["database_type"]
    
    @classmethod
    def database_name(cls) -> str:
        return cls._load()["database_name"]
    
    @classmethod
    def set_database_type(cls, db_type: str) -> None:
        cfg = cls._load()
        cfg["database_type"] = db_type
        cls._save(cfg)

    @classmethod
    def set_database_name(cls, db_name: str) -> None:
        cfg = cls._load()
        cfg["database_name"] = db_name
        cls._save(cfg)
    
    @classmethod
    def database_url(cls) -> str:
        _type = cls.database_type()
        _name = cls.database_name()
        
        sep = "///" if _type == "sqlite" else "//"
        return f"{_type}:{sep}{_name}"

    @classmethod
    def base_dir(cls) -> Path: return BASE_DIR

    @classmethod
    def set_download_dir(cls, path: str | Path) -> None:
        p = Path(path).expanduser()
        if not p.is_absolute():
            p = BASE_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        cfg = cls._load()
        cfg["download_dir"] = str(Path)
        cls._save(cfg)
    
    @classmethod
    def download_dir(cls) -> Path:
        raw = cls._load().get("download_dir", str(BASE_DIR / "downloads"))
        p = Path(raw).expanduser()
        if not p.is_absolute(): p = BASE_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p