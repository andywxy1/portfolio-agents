from typing import Any, Literal

from pydantic import BaseModel


class AnalysisJobConfig(BaseModel):
    depth_overrides: dict[str, Literal["full", "standard", "quick"]] | None = None
    max_debate_rounds: int | None = None


class StartAnalysisRequest(BaseModel):
    mode: Literal["single", "portfolio", "all_individual"] = "portfolio"
    ticker: str | None = None  # required for "single" mode
    tickers: list[str] | None = None
    config: AnalysisJobConfig | None = None


class StartAnalysisResponse(BaseModel):
    job_id: str
    status: str
    tickers: list[str]
    total_tickers: int
    mode: str = "portfolio"


class AnalysisJobListItem(BaseModel):
    """Lightweight job summary for the history page listing."""
    id: str
    status: str
    mode: str | None = None
    created_at: str
    completed_at: str | None = None
    tickers_total: int
    tickers_completed: int
    tickers_failed: int = 0
    error_message: str | None = None


class PositionAnalysisSummary(BaseModel):
    id: str
    ticker: str
    status: str
    signal: str | None = None
    analysis_depth: str
    current_price: float | None = None


class AnalysisJobResponse(BaseModel):
    id: str
    user_id: str
    status: str
    tickers: list[str]
    total_tickers: int
    completed_tickers: int
    config: AnalysisJobConfig | None = None
    error_message: str | None = None
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    position_analyses: list[PositionAnalysisSummary] | None = None


class InvestmentDebate(BaseModel):
    bull_case: str
    bear_case: str
    debate_history: str
    judge_decision: str


class RiskDebate(BaseModel):
    aggressive_view: str
    conservative_view: str
    neutral_view: str
    debate_history: str
    judge_decision: str


class PositionAnalysisResponse(BaseModel):
    id: str
    job_id: str
    user_id: str
    ticker: str
    analysis_depth: str
    status: str

    signal: str | None = None
    raw_decision: str | None = None

    market_report: dict[str, Any] | None = None
    sentiment_report: dict[str, Any] | None = None
    news_report: dict[str, Any] | None = None
    fundamentals_report: dict[str, Any] | None = None
    investment_debate: InvestmentDebate | None = None
    risk_debate: RiskDebate | None = None
    investment_plan: dict[str, Any] | None = None

    current_price: float | None = None
    price_change_pct: float | None = None

    error_message: str | None = None
    created_at: str
    completed_at: str | None = None
