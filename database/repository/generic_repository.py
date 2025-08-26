from typing import Generic, Type, TypeVar, List, Optional
from sqlmodel import SQLModel, Session, select


ModelType = TypeVar("ModelType", bound=SQLModel)

class GenericRepository(Generic[ModelType]):
    def __init__(self, session: Session, model: Type[ModelType]):
        self.session = session
        self.model = model
    
    def get(self, obj_id: int) -> Optional[ModelType]:
        return self.session.get(self.model, obj_id)
    
    def get_all(self) -> List[ModelType]:
        stmt = select(self.model)
        return self.session.exec(stmt).all()
    
    def create(self, obj_in: ModelType) -> ModelType:
        self.session.add(obj_in)
        self.session.commit()
        self.session.refresh(obj_in)
        return obj_in
    
    def delete(self, obj_id: int) -> Optional[ModelType]:
        obj = self.get(obj_id)
        if obj:
            self.session.delete(obj)
            self.session.commit()
        return obj