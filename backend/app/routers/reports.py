"""Report endpoints.

GET /api/reports       -> list reports (with filters and pagination)
GET /api/reports/:id   -> get a single report with full content
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.report import Report
from app.schemas.report import ReportListItem, ReportResponse

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("")
def list_reports(
    job_id: str | None = Query(None),
    ticker: str | None = Query(None),
    report_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """List reports with optional filters and pagination."""
    query = db.query(Report).filter(Report.user_id == user_id)

    if job_id:
        query = query.filter(Report.job_id == job_id)
    if ticker:
        query = query.filter(Report.ticker == ticker.upper())
    if report_type:
        query = query.filter(Report.report_type == report_type)

    total = query.count()
    reports = (
        query
        .order_by(Report.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = [
        ReportListItem(
            id=r.id,
            job_id=r.job_id,
            ticker=r.ticker,
            report_type=r.report_type,
            title=r.title,
            summary=r.summary,
            created_at=r.created_at,
        ).model_dump()
        for r in reports
    ]

    return {
        "data": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
    }


@router.get("/{report_id}", response_model=ReportResponse)
def get_report(
    report_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> ReportResponse:
    """Get a single report with full content."""
    report = (
        db.query(Report)
        .filter(Report.id == report_id, Report.user_id == user_id)
        .first()
    )
    if not report:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "REPORT_NOT_FOUND",
                    "message": f"Report '{report_id}' not found",
                }
            },
        )

    content = {}
    if report.content:
        try:
            content = json.loads(report.content)
        except (json.JSONDecodeError, TypeError):
            content = {"raw": report.content}

    return ReportResponse(
        id=report.id,
        job_id=report.job_id,
        position_analysis_id=report.position_analysis_id,
        user_id=report.user_id,
        ticker=report.ticker,
        report_type=report.report_type,
        title=report.title,
        content=content,
        summary=report.summary,
        created_at=report.created_at,
    )
