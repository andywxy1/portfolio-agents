from sqlalchemy import Column, Float, Index, Integer, String, Text

from app.database import Base


class PriceCache(Base):
    __tablename__ = "price_cache"

    id = Column(String, primary_key=True)
    ticker = Column(String, nullable=False)

    price = Column(Float, nullable=False)
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    volume = Column(Integer, nullable=True)

    change = Column(Float, nullable=True)
    change_pct = Column(Float, nullable=True)

    indicators = Column(Text, nullable=True)  # JSON
    market_status = Column(String, nullable=True)

    fetched_at = Column(String, nullable=False)

    __table_args__ = (
        Index("idx_price_cache_ticker", "ticker"),
    )
