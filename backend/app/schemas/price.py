from pydantic import BaseModel


class TechnicalIndicators(BaseModel):
    sma_20: float | None = None
    sma_50: float | None = None
    sma_200: float | None = None
    ema_12: float | None = None
    ema_26: float | None = None
    rsi_14: float | None = None
    macd: float | None = None
    macd_signal: float | None = None
    macd_histogram: float | None = None
    bollinger_upper: float | None = None
    bollinger_lower: float | None = None
    atr_14: float | None = None
    volume_sma_20: float | None = None


class PriceDataResponse(BaseModel):
    ticker: str
    price: float
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: int | None = None
    change: float | None = None
    change_pct: float | None = None
    market_status: str | None = None
    indicators: TechnicalIndicators | None = None
    fetched_at: str
    stale: bool = False
