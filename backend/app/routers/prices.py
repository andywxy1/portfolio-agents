"""Price endpoints.

GET /api/prices/batch?tickers=AAPL,NVDA,TSLA -> batch price fetch
GET /api/prices/:ticker                       -> get current price data for a ticker
GET /api/tickers/validate?ticker=AAPL         -> check if a ticker exists on Alpaca
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.schemas.price import BatchPriceResponse, PriceDataResponse, TickerValidationResponse
from app.services.pricing import get_price, get_prices_batch, validate_ticker

router = APIRouter(prefix="/api", tags=["prices"])


@router.get("/prices/batch", response_model=BatchPriceResponse)
def get_batch_prices(
    tickers: str = Query(..., description="Comma-separated list of ticker symbols"),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> BatchPriceResponse:
    """Get current prices for multiple tickers in one call.

    Query parameter: tickers=AAPL,NVDA,TSLA
    Returns a dict keyed by ticker symbol with price data for each.
    Tickers that fail to fetch will have price: null, stale: true.
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return BatchPriceResponse(prices={})

    # Cap at 50 tickers per request to prevent abuse
    ticker_list = ticker_list[:50]

    results = get_prices_batch(db, ticker_list)

    # Ensure every requested ticker has a response (never null in the dict)
    prices: dict[str, PriceDataResponse] = {}
    for ticker in ticker_list:
        result = results.get(ticker)
        if result is not None:
            prices[ticker] = result
        else:
            prices[ticker] = PriceDataResponse(
                ticker=ticker,
                price=None,
                fetched_at=None,
                stale=True,
            )

    return BatchPriceResponse(prices=prices)


@router.get("/prices/{ticker}", response_model=PriceDataResponse)
def get_ticker_price(
    ticker: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> PriceDataResponse:
    """Get current price data for a specific ticker."""
    return get_price(db, ticker)


@router.get("/tickers/validate", response_model=TickerValidationResponse)
def validate_ticker_endpoint(
    ticker: str = Query(..., description="Ticker symbol to validate"),
    user_id: str = Depends(require_api_key),
) -> TickerValidationResponse:
    """Check if a ticker symbol exists and is tradable on Alpaca.

    Returns { valid: true/false, name?: string, exchange?: string }.
    """
    result = validate_ticker(ticker)
    return TickerValidationResponse(**result)
