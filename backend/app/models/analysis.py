from sqlalchemy import Column, Float, ForeignKey, Index, Integer, String, Text

from app.database import Base


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, default="default")
    status = Column(String, nullable=False, default="pending")
    mode = Column(String, nullable=True, default="portfolio")
    tickers = Column(Text, nullable=False)  # JSON array
    total_tickers = Column(Integer, nullable=False, default=0)
    completed_tickers = Column(Integer, nullable=False, default=0)
    config = Column(Text, nullable=True)  # JSON
    error_message = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)
    started_at = Column(String, nullable=True)
    completed_at = Column(String, nullable=True)

    __table_args__ = (
        Index("idx_analysis_jobs_user_status", "user_id", "status"),
    )


class PositionAnalysis(Base):
    __tablename__ = "position_analyses"

    id = Column(String, primary_key=True)
    job_id = Column(String, ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, nullable=False, default="default")
    ticker = Column(String, nullable=False)
    analysis_depth = Column(String, nullable=False, default="full")
    status = Column(String, nullable=False, default="pending")

    signal = Column(String, nullable=True)
    raw_decision = Column(Text, nullable=True)

    market_report = Column(Text, nullable=True)
    sentiment_report = Column(Text, nullable=True)
    news_report = Column(Text, nullable=True)
    fundamentals_report = Column(Text, nullable=True)
    investment_debate = Column(Text, nullable=True)
    risk_debate = Column(Text, nullable=True)
    investment_plan = Column(Text, nullable=True)

    current_price = Column(Float, nullable=True)
    price_change_pct = Column(Float, nullable=True)

    error_message = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)
    completed_at = Column(String, nullable=True)

    __table_args__ = (
        Index("idx_position_analyses_job", "job_id"),
    )


class PortfolioInsight(Base):
    __tablename__ = "portfolio_insights"

    id = Column(String, primary_key=True)
    job_id = Column(String, ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, nullable=False, default="default")

    total_value = Column(Float, nullable=True)
    total_cost_basis = Column(Float, nullable=True)
    total_pnl = Column(Float, nullable=True)
    total_pnl_pct = Column(Float, nullable=True)

    allocation_breakdown = Column(Text, nullable=False)  # JSON
    sector_breakdown = Column(Text, nullable=True)  # JSON
    concentration_metrics = Column(Text, nullable=False)  # JSON
    risk_assessment = Column(Text, nullable=True)  # JSON

    summary = Column(Text, nullable=False)
    strengths = Column(Text, nullable=True)  # JSON
    weaknesses = Column(Text, nullable=True)  # JSON
    action_items = Column(Text, nullable=True)  # JSON

    created_at = Column(String, nullable=False)

    __table_args__ = (
        Index("idx_portfolio_insights_job", "job_id"),
    )
