from sqlalchemy import Column, Float, ForeignKey, Index, String, Text

from app.database import Base


class StockSuggestion(Base):
    __tablename__ = "stock_suggestions"

    id = Column(String, primary_key=True)
    job_id = Column(String, ForeignKey("analysis_jobs.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(String, nullable=False, default="default")
    ticker = Column(String, nullable=False)
    company_name = Column(String, nullable=False)

    sector = Column(String, nullable=False)
    industry = Column(String, nullable=True)
    rationale = Column(Text, nullable=False)
    gap_type = Column(String, nullable=False)

    current_price = Column(Float, nullable=True)
    market_cap = Column(Float, nullable=True)
    pe_ratio = Column(Float, nullable=True)
    dividend_yield = Column(Float, nullable=True)

    suggested_weight = Column(Float, nullable=True)
    suggested_shares = Column(Float, nullable=True)

    status = Column(String, nullable=False, default="pending")
    status_changed_at = Column(String, nullable=True)

    created_at = Column(String, nullable=False)

    __table_args__ = (
        Index("idx_stock_suggestions_user_status", "user_id", "status"),
        Index("idx_stock_suggestions_job", "job_id"),
    )
