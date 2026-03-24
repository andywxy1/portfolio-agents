"""Stock suggestion endpoints.

GET /api/suggestions -> list stock suggestions (with filters and pagination)
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.suggestion import StockSuggestion
from app.schemas.suggestion import StockSuggestionResponse

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.get("")
def list_suggestions(
    status: str | None = Query(None),
    gap_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """List stock suggestions with optional filters and pagination."""
    query = db.query(StockSuggestion).filter(StockSuggestion.user_id == user_id)

    if status:
        query = query.filter(StockSuggestion.status == status)
    if gap_type:
        query = query.filter(StockSuggestion.gap_type == gap_type)

    total = query.count()
    suggestions = (
        query
        .order_by(StockSuggestion.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    items = [
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
        ).model_dump()
        for s in suggestions
    ]

    return {
        "data": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + limit) < total,
    }
