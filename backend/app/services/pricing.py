"""Price fetching service with Alpaca integration and TTL-based caching.

Cache TTL: 60 seconds during market hours, 24 hours outside market hours.
Falls back to stale cached data if Alpaca is unreachable.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.price_cache import PriceCache
from app.schemas.price import PriceDataResponse, TechnicalIndicators

logger = logging.getLogger(__name__)

# US market hours: 9:30 AM - 4:00 PM Eastern, Mon-Fri
_MARKET_OPEN_HOUR = 9
_MARKET_OPEN_MINUTE = 30
_MARKET_CLOSE_HOUR = 16
_MARKET_CLOSE_MINUTE = 0

_CACHE_TTL_MARKET_HOURS = 60  # seconds
_CACHE_TTL_OFF_HOURS = 86400  # 24 hours in seconds


def _is_market_hours() -> bool:
    """Check if US stock market is currently open (approximate)."""
    now = datetime.now(timezone.utc)
    # Rough Eastern Time offset (UTC-5 or UTC-4 for DST)
    # For simplicity, use UTC-5 (EST). A production system would use pytz/zoneinfo.
    eastern_hour = (now.hour - 5) % 24
    eastern_minute = now.minute
    weekday = now.weekday()

    if weekday >= 5:  # Saturday=5, Sunday=6
        return False

    market_open = _MARKET_OPEN_HOUR * 60 + _MARKET_OPEN_MINUTE
    market_close = _MARKET_CLOSE_HOUR * 60 + _MARKET_CLOSE_MINUTE
    current = eastern_hour * 60 + eastern_minute

    return market_open <= current < market_close


def _get_cache_ttl() -> int:
    """Return the appropriate cache TTL based on market hours."""
    return _CACHE_TTL_MARKET_HOURS if _is_market_hours() else _CACHE_TTL_OFF_HOURS


def _get_market_status() -> str:
    """Return a simple market status string."""
    now = datetime.now(timezone.utc)
    weekday = now.weekday()
    if weekday >= 5:
        return "closed"

    eastern_hour = (now.hour - 5) % 24
    eastern_minute = now.minute
    current = eastern_hour * 60 + eastern_minute
    market_open = _MARKET_OPEN_HOUR * 60 + _MARKET_OPEN_MINUTE
    market_close = _MARKET_CLOSE_HOUR * 60 + _MARKET_CLOSE_MINUTE

    if current < market_open - 60:
        return "closed"
    elif current < market_open:
        return "pre"
    elif current < market_close:
        return "open"
    elif current < market_close + 120:
        return "post"
    else:
        return "closed"


def _get_cached_price(db: Session, ticker: str) -> PriceCache | None:
    """Retrieve the most recent cached price for a ticker."""
    return (
        db.query(PriceCache)
        .filter(PriceCache.ticker == ticker)
        .order_by(PriceCache.fetched_at.desc())
        .first()
    )


def _is_cache_fresh(cached: PriceCache) -> bool:
    """Check if a cached price entry is still within TTL."""
    try:
        fetched = datetime.fromisoformat(cached.fetched_at.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    age_seconds = (datetime.now(timezone.utc) - fetched).total_seconds()
    return age_seconds < _get_cache_ttl()


def _store_cache(db: Session, ticker: str, price_data: dict) -> PriceCache:
    """Store a price entry in the cache."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    entry = PriceCache(
        id=str(uuid.uuid4()),
        ticker=ticker,
        price=price_data["price"],
        open=price_data.get("open"),
        high=price_data.get("high"),
        low=price_data.get("low"),
        close=price_data.get("close"),
        volume=price_data.get("volume"),
        change=price_data.get("change"),
        change_pct=price_data.get("change_pct"),
        indicators=json.dumps(price_data.get("indicators")) if price_data.get("indicators") else None,
        market_status=price_data.get("market_status"),
        fetched_at=now,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _fetch_from_alpaca(ticker: str) -> dict | None:
    """Fetch latest price data from Alpaca Market Data API.

    Uses the alpaca-py SDK. Returns None if Alpaca credentials are missing
    or the request fails.
    """
    if not settings.alpaca_api_key or not settings.alpaca_secret_key:
        logger.warning("Alpaca credentials not configured; skipping price fetch for %s", ticker)
        return None

    try:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.requests import StockLatestQuoteRequest, StockBarsRequest
        from alpaca.data.timeframe import TimeFrame

        client = StockHistoricalDataClient(
            api_key=settings.alpaca_api_key,
            secret_key=settings.alpaca_secret_key,
        )

        # Get latest quote
        quote_request = StockLatestQuoteRequest(symbol_or_symbols=ticker)
        quotes = client.get_stock_latest_quote(quote_request)

        if ticker not in quotes:
            logger.warning("No quote data returned from Alpaca for %s", ticker)
            return None

        quote = quotes[ticker]
        mid_price = (quote.ask_price + quote.bid_price) / 2 if quote.ask_price and quote.bid_price else quote.ask_price or quote.bid_price

        # Get latest bar for OHLCV
        from alpaca.data.requests import StockLatestBarRequest
        bar_request = StockLatestBarRequest(symbol_or_symbols=ticker)
        bars = client.get_stock_latest_bar(bar_request)

        bar = bars.get(ticker)
        open_price = bar.open if bar else None
        high_price = bar.high if bar else None
        low_price = bar.low if bar else None
        close_price = bar.close if bar else None
        volume = int(bar.volume) if bar else None

        # Calculate change from previous close
        prev_close = close_price  # Approximate: use bar close
        change = (mid_price - prev_close) if prev_close and mid_price else None
        change_pct = (change / prev_close * 100) if prev_close and change else None

        return {
            "price": round(mid_price, 4) if mid_price else 0.0,
            "open": round(open_price, 4) if open_price else None,
            "high": round(high_price, 4) if high_price else None,
            "low": round(low_price, 4) if low_price else None,
            "close": round(close_price, 4) if close_price else None,
            "volume": volume,
            "change": round(change, 4) if change is not None else None,
            "change_pct": round(change_pct, 4) if change_pct is not None else None,
            "market_status": _get_market_status(),
        }

    except ImportError:
        logger.error("alpaca-py not installed; cannot fetch prices")
        return None
    except Exception:
        logger.exception("Failed to fetch price from Alpaca for %s", ticker)
        return None


def _cache_entry_to_response(entry: PriceCache, stale: bool = False) -> PriceDataResponse:
    """Convert a PriceCache ORM object to a PriceDataResponse."""
    indicators = None
    if entry.indicators:
        try:
            indicators = TechnicalIndicators(**json.loads(entry.indicators))
        except (json.JSONDecodeError, TypeError):
            pass

    return PriceDataResponse(
        ticker=entry.ticker,
        price=entry.price,
        open=entry.open,
        high=entry.high,
        low=entry.low,
        close=entry.close,
        volume=entry.volume,
        change=entry.change,
        change_pct=entry.change_pct,
        market_status=entry.market_status,
        indicators=indicators,
        fetched_at=entry.fetched_at,
        stale=stale,
    )


def get_price(db: Session, ticker: str) -> PriceDataResponse:
    """Get the current price for a ticker, using cache with TTL.

    Never raises. Returns a PriceDataResponse in all cases:
    1. Check cache -- if fresh, return cached data.
    2. Fetch from Alpaca -- if successful, cache and return.
    3. Fall back to stale cache with stale=True flag.
    4. If no data at all, return price=None with stale=True.
    """
    ticker = ticker.upper()

    # 1. Check cache
    cached = _get_cached_price(db, ticker)
    if cached and _is_cache_fresh(cached):
        return _cache_entry_to_response(cached, stale=False)

    # 2. Fetch from Alpaca
    fresh_data = _fetch_from_alpaca(ticker)
    if fresh_data:
        entry = _store_cache(db, ticker, fresh_data)
        return _cache_entry_to_response(entry, stale=False)

    # 3. Fall back to stale cache
    if cached:
        logger.info("Serving stale cached price for %s", ticker)
        return _cache_entry_to_response(cached, stale=True)

    # 4. No data available -- return null price with stale flag
    logger.warning("No price data available for %s (no cache, no Alpaca)", ticker)
    return PriceDataResponse(
        ticker=ticker,
        price=None,
        fetched_at=None,
        stale=True,
    )


def validate_ticker(ticker: str) -> dict:
    """Check if a ticker is valid on Alpaca. Returns {valid, name?, exchange?}.

    Never raises -- returns {valid: False} on any failure.
    """
    ticker = ticker.upper()

    if not settings.alpaca_api_key or not settings.alpaca_secret_key:
        logger.warning("Alpaca credentials not configured; cannot validate ticker %s", ticker)
        return {"valid": False}

    try:
        from alpaca.trading.client import TradingClient
        from alpaca.trading.requests import GetAssetsRequest
        from alpaca.trading.enums import AssetClass

        client = TradingClient(
            api_key=settings.alpaca_api_key,
            secret_key=settings.alpaca_secret_key,
            paper=True,
        )

        asset = client.get_asset(ticker)
        if asset and asset.tradable:
            return {
                "valid": True,
                "name": asset.name,
                "exchange": str(asset.exchange) if asset.exchange else None,
            }
        return {"valid": False}

    except ImportError:
        logger.error("alpaca-py not installed; cannot validate ticker")
        return {"valid": False}
    except Exception:
        logger.debug("Ticker validation failed for %s", ticker, exc_info=True)
        return {"valid": False}


def get_prices_batch(db: Session, tickers: list[str]) -> dict[str, PriceDataResponse]:
    """Get prices for multiple tickers. Returns a dict keyed by ticker.

    Never raises. If a ticker price is unavailable, returns a response
    with price=None and stale=True.
    """
    results: dict[str, PriceDataResponse] = {}
    for ticker in tickers:
        try:
            results[ticker.upper()] = get_price(db, ticker)
        except Exception:
            logger.warning("Could not fetch price for %s", ticker)
            results[ticker.upper()] = PriceDataResponse(
                ticker=ticker.upper(),
                price=None,
                fetched_at=None,
                stale=True,
            )
    return results
