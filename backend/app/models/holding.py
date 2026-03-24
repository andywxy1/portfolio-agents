from sqlalchemy import Column, Index, String, Text, Float

from app.database import Base


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, default="default")
    ticker = Column(String, nullable=False)
    shares = Column(Float, nullable=False)
    buy_price = Column(Float, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
    deleted_at = Column(String, nullable=True)

    __table_args__ = (
        Index("idx_holdings_user_active", "user_id", sqlite_where="deleted_at IS NULL"),
    )
