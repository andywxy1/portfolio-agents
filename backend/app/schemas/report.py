from typing import Any

from pydantic import BaseModel


class ReportListItem(BaseModel):
    id: str
    job_id: str
    ticker: str
    report_type: str
    title: str
    summary: str | None = None
    created_at: str


class ReportResponse(BaseModel):
    id: str
    job_id: str
    position_analysis_id: str | None = None
    user_id: str
    ticker: str
    report_type: str
    title: str
    content: dict[str, Any]
    summary: str | None = None
    created_at: str
