from pydantic import BaseModel, Field, field_validator


class HoldingBase(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.]+$")
    shares: float = Field(..., gt=0)
    buy_price: float = Field(..., ge=0)
    notes: str | None = None

    @field_validator("ticker", mode="before")
    @classmethod
    def uppercase_ticker(cls, v: str) -> str:
        return v.upper() if isinstance(v, str) else v


class HoldingCreate(HoldingBase):
    pass


class HoldingUpdate(BaseModel):
    ticker: str | None = Field(None, min_length=1, max_length=10, pattern=r"^[A-Za-z0-9.]+$")
    shares: float | None = Field(None, gt=0)
    buy_price: float | None = Field(None, ge=0)
    notes: str | None = None

    @field_validator("ticker", mode="before")
    @classmethod
    def uppercase_ticker(cls, v: str | None) -> str | None:
        return v.upper() if isinstance(v, str) else v


class HoldingResponse(BaseModel):
    id: str
    user_id: str
    ticker: str
    shares: float
    buy_price: float
    notes: str | None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class HoldingWithPrice(HoldingResponse):
    current_price: float | None = None
    market_value: float | None = None
    cost_basis: float
    pnl: float | None = None
    pnl_pct: float | None = None
    weight: float | None = None
    price_stale: bool = False
