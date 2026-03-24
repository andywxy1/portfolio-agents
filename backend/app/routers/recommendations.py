"""Recommendation endpoints.

GET   /api/recommendations       -> list recommendations (with filters)
PATCH /api/recommendations/:id   -> accept or dismiss a recommendation
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.recommendation import Recommendation
from app.schemas.common import PaginatedResponse
from app.schemas.recommendation import RecommendationResponse, UpdateRecommendationRequest
from app.utils import utc_now

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


def _to_response(r: Recommendation) -> RecommendationResponse:
    tags = None
    if r.tags:
        try:
            tags = json.loads(r.tags)
        except (json.JSONDecodeError, TypeError):
            tags = None

    return RecommendationResponse(
        id=r.id,
        job_id=r.job_id,
        user_id=r.user_id,
        ticker=r.ticker,
        order_type=r.order_type,
        side=r.side,
        quantity=r.quantity,
        limit_price=r.limit_price,
        stop_price=r.stop_price,
        time_in_force=r.time_in_force,
        expiration=r.expiration,
        condition_text=r.condition_text,
        confidence=r.confidence,
        rationale=r.rationale,
        priority=r.priority,
        tags=tags,
        status=r.status,
        status_changed_at=r.status_changed_at,
        status_note=r.status_note,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


@router.get("")
def list_recommendations(
    status: str | None = Query(None),
    ticker: str | None = Query(None),
    side: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """List recommendations with optional filters and pagination."""
    query = db.query(Recommendation).filter(Recommendation.user_id == user_id)

    if status:
        query = query.filter(Recommendation.status == status)
    if ticker:
        query = query.filter(Recommendation.ticker == ticker.upper())
    if side:
        query = query.filter(Recommendation.side == side)

    total = query.count()
    recs = (
        query
        .order_by(Recommendation.priority.desc(), Recommendation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "data": [_to_response(r).model_dump() for r in recs],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
    }


@router.patch("/{rec_id}", response_model=RecommendationResponse)
def update_recommendation(
    rec_id: str,
    body: UpdateRecommendationRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> RecommendationResponse:
    """Accept or dismiss a recommendation."""
    rec = (
        db.query(Recommendation)
        .filter(Recommendation.id == rec_id, Recommendation.user_id == user_id)
        .first()
    )
    if not rec:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RECOMMENDATION_NOT_FOUND",
                    "message": f"Recommendation '{rec_id}' not found",
                }
            },
        )

    if rec.status != "pending":
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_STATUS_TRANSITION",
                    "message": f"Cannot change status from '{rec.status}' to '{body.status}'. Only 'pending' recommendations can be updated.",
                }
            },
        )

    now = utc_now()
    rec.status = body.status
    rec.status_changed_at = now
    rec.status_note = body.status_note
    rec.updated_at = now
    db.commit()
    db.refresh(rec)

    return _to_response(rec)
