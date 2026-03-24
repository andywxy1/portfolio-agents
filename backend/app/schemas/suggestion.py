from pydantic import BaseModel


class StockSuggestionResponse(BaseModel):
    id: str
    job_id: str | None = None
    user_id: str
    ticker: str
    company_name: str

    sector: str
    industry: str | None = None
    rationale: str
    gap_type: str

    current_price: float | None = None
    market_cap: float | None = None
    pe_ratio: float | None = None
    dividend_yield: float | None = None

    suggested_weight: float | None = None
    suggested_shares: float | None = None

    status: str
    status_changed_at: str | None = None

    created_at: str
