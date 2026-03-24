from typing import Literal

from pydantic import BaseModel, Field


class RecommendationResponse(BaseModel):
    id: str
    job_id: str | None = None
    user_id: str
    ticker: str

    order_type: str
    side: str
    quantity: float
    limit_price: float | None = None
    stop_price: float | None = None
    time_in_force: str
    expiration: str | None = None

    condition_text: str | None = None

    confidence: float | None = None
    rationale: str
    priority: int
    tags: list[str] | None = None

    status: str
    status_changed_at: str | None = None
    status_note: str | None = None

    created_at: str
    updated_at: str


class UpdateRecommendationRequest(BaseModel):
    status: Literal["accepted", "dismissed"]
    status_note: str | None = Field(None)
