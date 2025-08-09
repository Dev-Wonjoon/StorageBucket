import json
from pathlib import Path


class Config:
    
    CONFIG_DIR = Path.home() / ".config" / "StorageBucket"
    CONFIG_FILE = CONFIG_DIR / "settings.json"
    
    DEFAULTS = {
        "database_type": "sqlite",
        "database_name": "bucket.db"
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