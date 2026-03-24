"""Stock suggestion endpoints.

GET /api/suggestions -> list stock suggestions (with filters)
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.suggestion import StockSuggestion
from app.schemas.suggestion import StockSuggestionResponse

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.get("", response_model=list[StockSuggestionResponse])
def list_suggestions(
    status: str | None = Query(None),
    gap_type: str | None = Query(None),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> list[StockSuggestionResponse]:
    """List stock suggestions with optional filters."""
    query = db.query(StockSuggestion).filter(StockSuggestion.user_id == user_id)

    if status:
        query = query.filter(StockSuggestion.status == status)
    if gap_type:
        query = query.filter(StockSuggestion.gap_type == gap_type)

    suggestions = query.order_by(StockSuggestion.created_at.desc()).all()

    return [
        StockSuggestionResponse(
            id=s.id,
            job_id=s.job_id,
            user_id=s.user_id,
            ticker=s.ticker,
            company_name=s.company_name,
            sector=s.sector,
            industry=s.industry,
            rationale=s.rationale,
            gap_type=s.gap_type,
            current_price=s.current_price,
            market_cap=s.market_cap,
            pe_ratio=s.pe_ratio,
            dividend_yield=s.dividend_yield,
            suggested_weight=s.suggested_weight,
            suggested_shares=s.suggested_shares,
            status=s.status,
            status_changed_at=s.status_changed_at,
            created_at=s.created_at,
        )
        for s in suggestions
    ]
