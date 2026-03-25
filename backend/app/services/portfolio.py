"""Portfolio calculation service.

Computes total value, P&L, allocation percentages, sector breakdown,
and HHI concentration index.
"""

import logging

from sqlalchemy.orm import Session

from app.models.holding import Holding
from app.schemas.holding import HoldingWithPrice
from app.schemas.portfolio import (
    AllocationEntry,
    ConcentrationMetrics,
    PortfolioSummaryResponse,
    SectorEntry,
)
from app.services.pricing import get_prices_batch

logger = logging.getLogger(__name__)

# Mapping of well-known tickers to GICS sectors.
# This is a simplified lookup; a production system would use a data provider.
TICKER_SECTOR_MAP: dict[str, str] = {
    # Information Technology
    "AAPL": "Information Technology", "MSFT": "Information Technology",
    "NVDA": "Information Technology", "AVGO": "Information Technology",
    "ORCL": "Information Technology", "CRM": "Information Technology",
    "AMD": "Information Technology", "ADBE": "Information Technology",
    "CSCO": "Information Technology", "INTC": "Information Technology",
    "QCOM": "Information Technology", "TXN": "Information Technology",
    "AMAT": "Information Technology", "MU": "Information Technology",
    "INTU": "Information Technology", "NOW": "Information Technology",
    "IBM": "Information Technology", "PANW": "Information Technology",
    "LRCX": "Information Technology", "KLAC": "Information Technology",
    # Communication Services
    "GOOGL": "Communication Services", "GOOG": "Communication Services",
    "META": "Communication Services", "NFLX": "Communication Services",
    "DIS": "Communication Services", "CMCSA": "Communication Services",
    "T": "Communication Services", "VZ": "Communication Services",
    "TMUS": "Communication Services", "CHTR": "Communication Services",
    # Consumer Discretionary
    "AMZN": "Consumer Discretionary", "TSLA": "Consumer Discretionary",
    "HD": "Consumer Discretionary", "MCD": "Consumer Discretionary",
    "NKE": "Consumer Discretionary", "LOW": "Consumer Discretionary",
    "SBUX": "Consumer Discretionary", "TJX": "Consumer Discretionary",
    "BKNG": "Consumer Discretionary", "CMG": "Consumer Discretionary",
    # Consumer Staples
    "WMT": "Consumer Staples", "PG": "Consumer Staples",
    "COST": "Consumer Staples", "KO": "Consumer Staples",
    "PEP": "Consumer Staples", "PM": "Consumer Staples",
    "MDLZ": "Consumer Staples", "MO": "Consumer Staples",
    "CL": "Consumer Staples", "KMB": "Consumer Staples",
    # Health Care
    "UNH": "Health Care", "JNJ": "Health Care",
    "LLY": "Health Care", "ABBV": "Health Care",
    "MRK": "Health Care", "PFE": "Health Care",
    "TMO": "Health Care", "ABT": "Health Care",
    "DHR": "Health Care", "BMY": "Health Care",
    "AMGN": "Health Care", "GILD": "Health Care",
    "ISRG": "Health Care", "MDT": "Health Care",
    "SYK": "Health Care", "REGN": "Health Care",
    # Financials
    "BRK.B": "Financials", "JPM": "Financials",
    "V": "Financials", "MA": "Financials",
    "BAC": "Financials", "WFC": "Financials",
    "GS": "Financials", "MS": "Financials",
    "SPGI": "Financials", "BLK": "Financials",
    "AXP": "Financials", "C": "Financials",
    "SCHW": "Financials", "CB": "Financials",
    # Energy
    "XOM": "Energy", "CVX": "Energy",
    "COP": "Energy", "SLB": "Energy",
    "EOG": "Energy", "MPC": "Energy",
    "PSX": "Energy", "PXD": "Energy",
    "VLO": "Energy", "OXY": "Energy",
    # Industrials
    "GE": "Industrials", "CAT": "Industrials",
    "UNP": "Industrials", "HON": "Industrials",
    "RTX": "Industrials", "BA": "Industrials",
    "DE": "Industrials", "LMT": "Industrials",
    "UPS": "Industrials", "MMM": "Industrials",
    "GD": "Industrials", "NOC": "Industrials",
    # Materials
    "LIN": "Materials", "APD": "Materials",
    "SHW": "Materials", "ECL": "Materials",
    "NEM": "Materials", "FCX": "Materials",
    "DD": "Materials", "NUE": "Materials",
    # Real Estate
    "PLD": "Real Estate", "AMT": "Real Estate",
    "CCI": "Real Estate", "EQIX": "Real Estate",
    "PSA": "Real Estate", "SPG": "Real Estate",
    "O": "Real Estate", "WELL": "Real Estate",
    # Utilities
    "NEE": "Utilities", "DUK": "Utilities",
    "SO": "Utilities", "D": "Utilities",
    "AEP": "Utilities", "SRE": "Utilities",
    "EXC": "Utilities", "XEL": "Utilities",
}


def get_sector(ticker: str) -> str:
    """Look up the GICS sector for a ticker. Returns 'Unknown' if not mapped."""
    return TICKER_SECTOR_MAP.get(ticker.upper(), "Unknown")


def compute_portfolio_summary(
    db: Session,
    holdings: list[Holding],
) -> PortfolioSummaryResponse:
    """Compute full portfolio summary with live prices."""
    if not holdings:
        return PortfolioSummaryResponse(
            total_value=None,
            total_cost_basis=0.0,
            total_pnl=None,
            total_pnl_pct=None,
            holdings_count=0,
            allocation=[],
            sector_breakdown=[],
            concentration=None,
            prices_as_of=None,
            any_prices_stale=False,
        )

    tickers = [h.ticker for h in holdings]
    prices = get_prices_batch(db, tickers)

    allocation: list[AllocationEntry] = []
    any_stale = False
    latest_fetched_at: str | None = None

    for h in holdings:
        price_data = prices.get(h.ticker.upper())
        current_price = price_data.price if price_data and price_data.price is not None else None
        cost_basis = h.shares * h.buy_price
        market_value = h.shares * current_price if current_price is not None else None
        pnl = (market_value - cost_basis) if market_value is not None else None
        pnl_pct = (pnl / cost_basis) if pnl is not None and cost_basis > 0 else None

        if price_data and price_data.stale:
            any_stale = True
        if price_data and price_data.fetched_at:
            if latest_fetched_at is None or price_data.fetched_at > latest_fetched_at:
                latest_fetched_at = price_data.fetched_at

        allocation.append(
            AllocationEntry(
                ticker=h.ticker,
                shares=h.shares,
                buy_price=h.buy_price,
                current_price=current_price,
                market_value=market_value,
                cost_basis=cost_basis,
                weight=None,  # Filled in below
                pnl=pnl,
                pnl_pct=pnl_pct,
            )
        )

    # Calculate total value and weights
    total_value: float | None = None
    values_with_price = [a.market_value for a in allocation if a.market_value is not None]
    if values_with_price:
        total_value = sum(values_with_price)
        # Add cost basis for positions without prices
        for a in allocation:
            if a.market_value is None:
                total_value += a.cost_basis

    # Set weights -- use market values if available, fall back to cost basis
    total_for_weights = total_value if total_value is not None else sum(a.cost_basis for a in allocation)
    if total_for_weights > 0:
        for a in allocation:
            val = a.market_value if a.market_value is not None else a.cost_basis
            a.weight = val / total_for_weights

    total_cost_basis = sum(a.cost_basis for a in allocation)
    total_pnl = (total_value - total_cost_basis) if total_value is not None else None
    total_pnl_pct = (total_pnl / total_cost_basis) if total_pnl is not None and total_cost_basis > 0 else None

    # Sector breakdown
    sector_map: dict[str, list[str]] = {}
    sector_weight_map: dict[str, float] = {}
    for a in allocation:
        sector = get_sector(a.ticker)
        sector_map.setdefault(sector, []).append(a.ticker)
        sector_weight_map[sector] = sector_weight_map.get(sector, 0.0) + (a.weight or 0.0)

    sector_breakdown = [
        SectorEntry(sector=sector, weight=round(weight, 6), tickers=tickers_list)
        for sector, tickers_list in sector_map.items()
        if (weight := sector_weight_map.get(sector, 0.0)) or True
    ]
    sector_breakdown.sort(key=lambda s: s.weight, reverse=True)

    # Concentration metrics (HHI)
    concentration = _compute_concentration(allocation)

    return PortfolioSummaryResponse(
        total_value=round(total_value, 2) if total_value is not None else None,
        total_cost_basis=round(total_cost_basis, 2),
        total_pnl=round(total_pnl, 2) if total_pnl is not None else None,
        total_pnl_pct=round(total_pnl_pct, 6) if total_pnl_pct is not None else None,
        holdings_count=len(holdings),
        allocation=allocation,
        sector_breakdown=sector_breakdown,
        concentration=concentration,
        prices_as_of=latest_fetched_at,
        any_prices_stale=any_stale,
    )


def _compute_concentration(allocation: list[AllocationEntry]) -> ConcentrationMetrics | None:
    """Compute HHI and top-N concentration metrics."""
    weights = [a.weight for a in allocation if a.weight is not None and a.weight > 0]
    if not weights:
        return None

    # HHI: sum of squared weights * 10000 (standard scale)
    hhi = sum(w * w for w in weights) * 10000

    sorted_weights = sorted(weights, reverse=True)
    top3 = sum(sorted_weights[:3])
    top5 = sum(sorted_weights[:5])
    max_weight = sorted_weights[0]

    max_ticker = ""
    for a in allocation:
        if a.weight == max_weight:
            max_ticker = a.ticker
            break

    return ConcentrationMetrics(
        hhi=round(hhi, 2),
        top3_weight=round(top3, 6),
        top5_weight=round(top5, 6),
        max_position_weight=round(max_weight, 6),
        max_position_ticker=max_ticker,
    )


def compute_allocation_concentration_sectors(
    holdings: list[Holding],
    current_prices: dict[str, float],
) -> tuple[list[dict], dict, list[dict]]:
    """Shared helper: compute allocation, concentration, and sector breakdown.

    Used by both the analysis runner (for portfolio insight generation) and
    the portfolio summary endpoint. Avoids duplicating the weight/HHI/sector
    calculation logic in two places.

    Parameters
    ----------
    holdings : list[Holding]
        Active holding ORM objects.
    current_prices : dict[str, float]
        Mapping of uppercase ticker -> current price. Falls back to buy_price
        for tickers not present.

    Returns
    -------
    (allocation, concentration, sector_breakdown)
        allocation : list of dicts with ticker, shares, buy_price, current_price,
            market_value, cost_basis, weight, pnl, pnl_pct
        concentration : dict with hhi, top3_weight, top5_weight, etc.
        sector_breakdown : list of dicts with sector, weight, tickers
    """
    entries: list[dict] = []
    total_value = 0.0
    for h in holdings:
        price = current_prices.get(h.ticker.upper())
        if price is not None:
            market_value = h.shares * price
        else:
            market_value = h.shares * h.buy_price
            price = None
        cost_basis = h.shares * h.buy_price
        pnl = (market_value - cost_basis) if market_value else None
        pnl_pct = (pnl / cost_basis) if pnl is not None and cost_basis > 0 else None
        total_value += market_value
        entries.append({
            "ticker": h.ticker,
            "shares": h.shares,
            "buy_price": h.buy_price,
            "current_price": price,
            "market_value": round(market_value, 2),
            "cost_basis": round(cost_basis, 2),
            "weight": 0.0,
            "pnl": round(pnl, 2) if pnl is not None else None,
            "pnl_pct": round(pnl_pct, 6) if pnl_pct is not None else None,
        })

    if total_value > 0:
        for e in entries:
            e["weight"] = round(e["market_value"] / total_value, 6)

    # Concentration (HHI)
    weights = [e["weight"] for e in entries if e["weight"] > 0]
    sorted_w = sorted(weights, reverse=True)
    hhi = sum(w * w for w in weights) * 10000 if weights else 0
    max_ticker = ""
    for e in entries:
        if sorted_w and e["weight"] == sorted_w[0]:
            max_ticker = e["ticker"]
            break
    concentration = {
        "hhi": round(hhi, 2),
        "top3_weight": round(sum(sorted_w[:3]), 6),
        "top5_weight": round(sum(sorted_w[:5]), 6),
        "max_position_weight": round(sorted_w[0], 6) if sorted_w else 0,
        "max_position_ticker": max_ticker,
    }

    # Sector breakdown
    sector_map: dict[str, dict] = {}
    for e in entries:
        sector = get_sector(e["ticker"])
        if sector not in sector_map:
            sector_map[sector] = {"sector": sector, "weight": 0.0, "tickers": []}
        sector_map[sector]["weight"] += e["weight"]
        sector_map[sector]["tickers"].append(e["ticker"])
    sector_breakdown = sorted(
        sector_map.values(), key=lambda s: s["weight"], reverse=True
    )

    return entries, concentration, sector_breakdown


def get_holdings_with_prices(
    db: Session, holdings: list[Holding]
) -> list[HoldingWithPrice]:
    """Enrich holdings with live price data for the holdings list endpoint."""
    if not holdings:
        return []

    tickers = [h.ticker for h in holdings]
    prices = get_prices_batch(db, tickers)

    # Compute total portfolio value for weight calculation
    total_value = 0.0
    position_values: list[float] = []
    for h in holdings:
        price_data = prices.get(h.ticker.upper())
        current_price = price_data.price if price_data and price_data.price is not None else None
        if current_price is not None:
            val = h.shares * current_price
        else:
            val = h.shares * h.buy_price  # fall back to cost basis
        position_values.append(val)
        total_value += val

    result: list[HoldingWithPrice] = []
    for i, h in enumerate(holdings):
        price_data = prices.get(h.ticker.upper())
        current_price = price_data.price if price_data and price_data.price is not None else None
        cost_basis = h.shares * h.buy_price
        market_value = h.shares * current_price if current_price is not None else None
        pnl = (market_value - cost_basis) if market_value is not None else None
        pnl_pct = (pnl / cost_basis) if pnl is not None and cost_basis > 0 else None
        weight = position_values[i] / total_value if total_value > 0 else None
        stale = price_data.stale if price_data else False

        result.append(
            HoldingWithPrice(
                id=h.id,
                user_id=h.user_id,
                ticker=h.ticker,
                shares=h.shares,
                buy_price=h.buy_price,
                notes=h.notes,
                created_at=h.created_at,
                updated_at=h.updated_at,
                current_price=current_price,
                market_value=round(market_value, 2) if market_value is not None else None,
                cost_basis=round(cost_basis, 2),
                pnl=round(pnl, 2) if pnl is not None else None,
                pnl_pct=round(pnl_pct, 6) if pnl_pct is not None else None,
                weight=round(weight, 6) if weight is not None else None,
                price_stale=stale,
            )
        )

    return result
