from sqlalchemy import Column, Float, ForeignKey, Index, Integer, String, Text

from app.database import Base


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(String, primary_key=True)
    job_id = Column(String, ForeignKey("analysis_jobs.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(String, nullable=False, default="default")
    ticker = Column(String, nullable=False)

    order_type = Column(String, nullable=False)
    side = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    limit_price = Column(Float, nullable=True)
    stop_price = Column(Float, nullable=True)
    time_in_force = Column(String, nullable=False, default="day")
    expiration = Column(String, nullable=True)

    condition_text = Column(Text, nullable=True)

    confidence = Column(Float, nullable=True)
    rationale = Column(Text, nullable=False)
    priority = Column(Integer, nullable=False, default=0)
    tags = Column(Text, nullable=True)  # JSON

    status = Column(String, nullable=False, default="pending")
    status_changed_at = Column(String, nullable=True)
    status_note = Column(Text, nullable=True)

    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    __table_args__ = (
        Index("idx_recommendations_user_status", "user_id", "status"),
        Index("idx_recommendations_job", "job_id"),
    )
