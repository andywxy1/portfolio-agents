from sqlalchemy import Column, String, Text

from app.database import Base


class AppMetadata(Base):
    __tablename__ = "app_metadata"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(String, nullable=False)
