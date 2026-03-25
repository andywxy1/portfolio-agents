"""Portfolio summary and history endpoints.

GET /api/portfolio/summary      -> full portfolio summary with live prices
GET /api/portfolio/pnl-history  -> portfolio value snapshots over time
"""

import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.analysis import AnalysisJob, PortfolioInsight
from app.models.holding import Holding
from app.schemas.portfolio import PortfolioSummaryResponse
from app.services.portfolio import compute_portfolio_summary

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])


@router.get("/summary", response_model=PortfolioSummaryResponse)
def get_portfolio_summary(
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> PortfolioSummaryResponse:
    """Get portfolio summary with P&L, allocation, sector breakdown, and concentration."""
    holdings = (
        db.query(Holding)
        .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
        .all()
    )
    return compute_portfolio_summary(db, holdings)


@router.get("/pnl-history")
def get_pnl_history(
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> list[dict]:
    """Return portfolio value snapshots over time.

    Computed from completed analysis jobs and their stored portfolio insights.
    Each entry: {date, total_value, total_cost, pnl, pnl_pct}.
    """
    insights = (
        db.query(PortfolioInsight)
        .join(AnalysisJob, AnalysisJob.id == PortfolioInsight.job_id)
        .filter(
            PortfolioInsight.user_id == user_id,
            AnalysisJob.status == "completed",
        )
        .order_by(PortfolioInsight.created_at.asc())
        .all()
    )

    # Deduplicate by date, keeping the latest entry per day (insights
    # are ordered by created_at ASC, so later entries overwrite earlier
    # ones for the same date).
    by_date: dict[str, dict] = {}
    for insight in insights:
        total_value = insight.total_value
        total_cost = insight.total_cost_basis
        pnl = insight.total_pnl
        pnl_pct = insight.total_pnl_pct

        # Extract date portion from created_at timestamp
        date_str = insight.created_at[:10] if insight.created_at else None
        if date_str is None:
            continue

        by_date[date_str] = {
            "date": date_str,
            "total_value": round(total_value, 2) if total_value is not None else None,
            "total_cost": round(total_cost, 2) if total_cost is not None else None,
            "pnl": round(pnl, 2) if pnl is not None else None,
            "pnl_pct": round(pnl_pct, 6) if pnl_pct is not None else None,
        }

    # Return sorted by date (string sort is correct for ISO dates)
    return sorted(by_date.values(), key=lambda d: d["date"])
