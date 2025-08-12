from sqlmodel import SQLModel, create_engine, Session
from src.core.config import Config

engine = create_engine(Config.database_url(), echo=False, connect_args={"check_same_thread": False})

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session() -> Session:
    return Session(engine)