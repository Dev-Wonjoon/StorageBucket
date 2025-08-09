from sqlmodel import SQLModel, create_engine
from src.core.config import Config

def init_db():
    db_url = Config.database_url()
    engine = create_engine(db_url, echo=True)
    
    SQLModel.metadata.create_all(engine)
    
    return engine
