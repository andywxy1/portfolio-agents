"""Price endpoint.

GET /api/prices/:ticker -> get current price data for a ticker
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.schemas.price import PriceDataResponse
from app.services.pricing import get_price

router = APIRouter(prefix="/api/prices", tags=["prices"])


@router.get("/{ticker}", response_model=PriceDataResponse)
def get_ticker_price(
    ticker: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> PriceDataResponse:
    """Get current price data for a specific ticker."""
    return get_price(db, ticker)
