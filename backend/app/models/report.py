from sqlalchemy import Column, ForeignKey, Index, String, Text

from app.database import Base


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True)
    job_id = Column(String, ForeignKey("analysis_jobs.id", ondelete="CASCADE"), nullable=False)
    position_analysis_id = Column(
        String, ForeignKey("position_analyses.id", ondelete="CASCADE"), nullable=True
    )
    user_id = Column(String, nullable=False, default="default")
    ticker = Column(String, nullable=False)

    report_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False)  # JSON
    summary = Column(Text, nullable=True)

    created_at = Column(String, nullable=False)

    __table_args__ = (
        Index("idx_reports_job", "job_id"),
        Index("idx_reports_position_analysis", "position_analysis_id"),
    )
