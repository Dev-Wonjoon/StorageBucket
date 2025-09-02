from typing import Generic, Type, TypeVar, List, Optional
from sqlmodel import SQLModel, Session, select
from core.database import SessionLocal


ModelType = TypeVar("ModelType", bound=SQLModel)

class GenericRepository(Generic[ModelType]):
    def __init__(self, model: Type[ModelType]):
        self.model = model
    
    def get(self, obj_id: int) -> Optional[ModelType]:
        with SessionLocal() as session:
            return session.get(self.model, obj_id)
    
    def get_all(self) -> List[ModelType]:
        with SessionLocal() as session:
            stmt = select(self.model)
            return session.exec(stmt).all()
    
    def create(self, obj_in: ModelType) -> ModelType:
        with SessionLocal() as session:
            session.add(obj_in)
            session.commit()
            session.refresh(obj_in)
            return obj_in
    
    def delete(self, obj_id: int) -> Optional[ModelType]:
        with SessionLocal() as session:
            obj = session.get(obj_id)
            if obj:
                session.delete(obj)
                session.commit()
            return obj