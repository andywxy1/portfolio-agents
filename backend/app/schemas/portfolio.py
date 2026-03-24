from typing import Any

from pydantic import BaseModel


class AllocationEntry(BaseModel):
    ticker: str
    shares: float
    buy_price: float
    current_price: float | None = None
    market_value: float | None = None
    cost_basis: float
    weight: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None


class SectorEntry(BaseModel):
    sector: str
    weight: float
    tickers: list[str]


class ConcentrationMetrics(BaseModel):
    hhi: float
    top3_weight: float
    top5_weight: float
    max_position_weight: float
    max_position_ticker: str


class PortfolioSummaryResponse(BaseModel):
    total_value: float | None = None
    total_cost_basis: float
    total_pnl: float | None = None
    total_pnl_pct: float | None = None
    holdings_count: int
    allocation: list[AllocationEntry]
    sector_breakdown: list[SectorEntry]
    concentration: ConcentrationMetrics | None = None
    prices_as_of: str | None = None
    any_prices_stale: bool = False


class PortfolioInsightResponse(BaseModel):
    id: str
    job_id: str
    user_id: str

    total_value: float | None = None
    total_cost_basis: float | None = None
    total_pnl: float | None = None
    total_pnl_pct: float | None = None

    allocation_breakdown: list[AllocationEntry]
    sector_breakdown: list[SectorEntry] | None = None
    concentration_metrics: ConcentrationMetrics
    risk_assessment: dict[str, Any] | None = None

    summary: str
    strengths: list[str] | None = None
    weaknesses: list[str] | None = None
    action_items: list[str] | None = None

    created_at: str
