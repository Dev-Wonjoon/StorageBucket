from sqlmodel import create_engine, Session, SQLModel
from sqlalchemy.orm import sessionmaker

engine = create_engine("sqlite:///storagebucket.db", connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)

def init_db():
    SQLModel.metadata.create_all(engine)