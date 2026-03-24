"""Holdings CRUD endpoints.

GET    /api/holdings          -> list all holdings with live prices
POST   /api/holdings          -> create a new holding (with live price)
PUT    /api/holdings/:id      -> update a holding
DELETE /api/holdings/:id      -> soft-delete a holding
GET    /api/holdings/export   -> CSV download of holdings
POST   /api/holdings/import   -> CSV upload to bulk-create holdings
"""

import csv
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
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
from app.utils import utc_now

router = APIRouter(prefix="/api/holdings", tags=["holdings"])


@router.get("/export")
def export_holdings_csv(
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> StreamingResponse:
    """Export all active holdings as a CSV file download."""
    holdings = (
        db.query(Holding)
        .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
        .order_by(Holding.created_at.desc())
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ticker", "shares", "buy_price", "notes"])
    for h in holdings:
        writer.writerow([h.ticker, h.shares, h.buy_price, h.notes or ""])
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=holdings.csv"},
    )


@router.post("/import")
async def import_holdings_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """Import holdings from a CSV file upload.

    Expected columns: ticker, shares, buy_price, notes (optional).
    Skips rows where the ticker already exists as an active holding.
    Returns { imported: N, errors: [{row: N, message: "..."}] }.
    """
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # Handle BOM from Excel
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    # Normalise header names (strip whitespace, lowercase)
    if reader.fieldnames:
        reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]

    # Pre-load existing active tickers for this user
    existing_tickers: set[str] = set()
    existing = (
        db.query(Holding.ticker)
        .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
        .all()
    )
    for (ticker,) in existing:
        existing_tickers.add(ticker.upper())

    imported = 0
    errors: list[dict] = []
    now = utc_now()

    for row_num, row in enumerate(reader, start=2):  # Row 1 is header
        ticker_raw = (row.get("ticker") or "").strip().upper()
        shares_raw = (row.get("shares") or "").strip()
        buy_price_raw = (row.get("buy_price") or "").strip()
        notes = (row.get("notes") or "").strip() or None

        # Validate ticker
        if not ticker_raw:
            errors.append({"row": row_num, "message": "Ticker is required"})
            continue

        # Validate shares
        try:
            shares = float(shares_raw)
            if shares <= 0:
                raise ValueError
        except (ValueError, TypeError):
            errors.append({"row": row_num, "message": f"Invalid shares value: '{shares_raw}'"})
            continue

        # Validate buy_price
        try:
            buy_price = float(buy_price_raw)
            if buy_price < 0:
                raise ValueError
        except (ValueError, TypeError):
            errors.append({"row": row_num, "message": f"Invalid buy_price value: '{buy_price_raw}'"})
            continue

        # Skip duplicates
        if ticker_raw in existing_tickers:
            errors.append({"row": row_num, "message": f"Ticker {ticker_raw} already exists, skipped"})
            continue

        holding = Holding(
            id=str(uuid.uuid4()),
            user_id=user_id,
            ticker=ticker_raw,
            shares=shares,
            buy_price=buy_price,
            notes=notes,
            created_at=now,
            updated_at=now,
        )
        db.add(holding)
        existing_tickers.add(ticker_raw)
        imported += 1

    db.commit()

    return {"imported": imported, "errors": errors}


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


@router.post("", response_model=HoldingWithPrice, status_code=201)
def create_holding(
    body: HoldingCreate,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> HoldingWithPrice:
    """Create a new holding. Ticker must be unique per user.

    Immediately fetches the current price from Alpaca and returns enriched data
    including current_price, market_value, unrealized_pnl, and weight.
    """
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

    now = utc_now()
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

    # Fetch all active holdings to compute accurate weights
    all_holdings = (
        db.query(Holding)
        .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
        .order_by(Holding.created_at.desc())
        .all()
    )
    enriched = get_holdings_with_prices(db, all_holdings)

    # Return the newly created holding from the enriched list
    for h in enriched:
        if h.id == holding.id:
            return h

    # Fallback: should never happen, but return minimal enriched data
    from app.services.pricing import get_price
    price_data = get_price(db, ticker)
    current_price = price_data.price if price_data else None
    cost_basis = holding.shares * holding.buy_price
    market_value = holding.shares * current_price if current_price is not None else None
    pnl = (market_value - cost_basis) if market_value is not None else None
    pnl_pct = (pnl / cost_basis) if pnl is not None and cost_basis > 0 else None

    return HoldingWithPrice(
        id=holding.id,
        user_id=holding.user_id,
        ticker=holding.ticker,
        shares=holding.shares,
        buy_price=holding.buy_price,
        notes=holding.notes,
        created_at=holding.created_at,
        updated_at=holding.updated_at,
        current_price=current_price,
        market_value=round(market_value, 2) if market_value is not None else None,
        cost_basis=round(cost_basis, 2),
        pnl=round(pnl, 2) if pnl is not None else None,
        pnl_pct=round(pnl_pct, 6) if pnl_pct is not None else None,
        weight=None,
        price_stale=price_data.stale if price_data else False,
    )


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
    holding.updated_at = utc_now()

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

    holding.deleted_at = utc_now()
    holding.updated_at = utc_now()
    db.commit()
