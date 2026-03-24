"""Holdings CRUD endpoints.

GET    /api/holdings          -> list all holdings with live prices
POST   /api/holdings          -> create a new holding
PUT    /api/holdings/:id      -> update a holding
DELETE /api/holdings/:id      -> soft-delete a holding
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.holding import Holding
from app.schemas.holding import (
    HoldingCreate,
    HoldingResponse,
    HoldingUpdate,
    HoldingWithPrice,
)
from app.services.portfolio import get_holdings_with_prices

router = APIRouter(prefix="/api/holdings", tags=["holdings"])


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


@router.get("", response_model=list[HoldingWithPrice])
def list_holdings(
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> list[HoldingWithPrice]:
    """List all active holdings enriched with live price data."""
    holdings = (
        db.query(Holding)
        .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
        .order_by(Holding.created_at.desc())
        .all()
    )
    return get_holdings_with_prices(db, holdings)


@router.post("", response_model=HoldingResponse, status_code=201)
def create_holding(
    body: HoldingCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> HoldingResponse:
    """Create a new holding. Ticker must be unique per user."""
    ticker = body.ticker.upper()

    # Check for duplicate active holding
    existing = (
        db.query(Holding)
        .filter(
            Holding.user_id == user_id,
            Holding.ticker == ticker,
            Holding.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "DUPLICATE_TICKER",
                    "message": f"Active holding for {ticker} already exists. Update the existing holding or delete it first.",
                }
            },
        )

    now = _now()
    holding = Holding(
        id=str(uuid.uuid4()),
        user_id=user_id,
        ticker=ticker,
        shares=body.shares,
        buy_price=body.buy_price,
        notes=body.notes,
        created_at=now,
        updated_at=now,
    )
    db.add(holding)
    db.commit()
    db.refresh(holding)

    return HoldingResponse.model_validate(holding)


@router.put("/{holding_id}", response_model=HoldingResponse)
def update_holding(
    holding_id: str,
    body: HoldingUpdate,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> HoldingResponse:
    """Update an existing holding."""
    holding = (
        db.query(Holding)
        .filter(
            Holding.id == holding_id,
            Holding.user_id == user_id,
            Holding.deleted_at.is_(None),
        )
        .first()
    )
    if not holding:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "HOLDING_NOT_FOUND",
                    "message": f"Holding with id '{holding_id}' not found",
                }
            },
        )

    update_data = body.model_dump(exclude_unset=True)

    # If ticker is being changed, check for duplicates
    if "ticker" in update_data:
        new_ticker = update_data["ticker"].upper()
        update_data["ticker"] = new_ticker
        existing = (
            db.query(Holding)
            .filter(
                Holding.user_id == user_id,
                Holding.ticker == new_ticker,
                Holding.deleted_at.is_(None),
                Holding.id != holding_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": {
                        "code": "DUPLICATE_TICKER",
                        "message": f"Active holding for {new_ticker} already exists.",
                    }
                },
            )

    for field, value in update_data.items():
        setattr(holding, field, value)
    holding.updated_at = _now()

    db.commit()
    db.refresh(holding)

    return HoldingResponse.model_validate(holding)


@router.delete("/{holding_id}", status_code=204)
def delete_holding(
    holding_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> None:
    """Soft-delete a holding."""
    holding = (
        db.query(Holding)
        .filter(
            Holding.id == holding_id,
            Holding.user_id == user_id,
            Holding.deleted_at.is_(None),
        )
        .first()
    )
    if not holding:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "HOLDING_NOT_FOUND",
                    "message": f"Holding with id '{holding_id}' not found",
                }
            },
        )

    holding.deleted_at = _now()
    holding.updated_at = _now()
    db.commit()
