"""Portfolio summary endpoint.

GET /api/portfolio/summary -> full portfolio summary with live prices
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
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
