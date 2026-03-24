"""Sector-gap analysis engine for stock suggestions.

Compares portfolio sector weights against S&P 500 sector weights,
identifies underweight sectors, and suggests top stocks from those sectors.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.holding import Holding
from app.models.suggestion import StockSuggestion
from app.services.portfolio import get_sector

logger = logging.getLogger(__name__)

# S&P 500 approximate sector weights (as of early 2026, rounded)
SP500_SECTOR_WEIGHTS: dict[str, float] = {
    "Information Technology": 0.30,
    "Health Care": 0.12,
    "Financials": 0.13,
    "Consumer Discretionary": 0.10,
    "Communication Services": 0.09,
    "Industrials": 0.08,
    "Consumer Staples": 0.06,
    "Energy": 0.04,
    "Utilities": 0.03,
    "Real Estate": 0.02,
    "Materials": 0.03,
}

# Top stocks per GICS sector with metadata for suggestions
SECTOR_TOP_STOCKS: dict[str, list[dict]] = {
    "Information Technology": [
        {"ticker": "AAPL", "name": "Apple Inc.", "industry": "Consumer Electronics", "market_cap": 3.2e12, "pe": 32.5, "div_yield": 0.005},
        {"ticker": "MSFT", "name": "Microsoft Corp.", "industry": "Software", "market_cap": 3.0e12, "pe": 35.2, "div_yield": 0.007},
        {"ticker": "NVDA", "name": "NVIDIA Corp.", "industry": "Semiconductors", "market_cap": 2.8e12, "pe": 55.0, "div_yield": 0.001},
        {"ticker": "AVGO", "name": "Broadcom Inc.", "industry": "Semiconductors", "market_cap": 800e9, "pe": 35.0, "div_yield": 0.012},
        {"ticker": "CRM", "name": "Salesforce Inc.", "industry": "Software", "market_cap": 280e9, "pe": 42.0, "div_yield": 0.005},
    ],
    "Health Care": [
        {"ticker": "UNH", "name": "UnitedHealth Group", "industry": "Managed Health Care", "market_cap": 480e9, "pe": 22.0, "div_yield": 0.014},
        {"ticker": "LLY", "name": "Eli Lilly & Co.", "industry": "Pharmaceuticals", "market_cap": 700e9, "pe": 65.0, "div_yield": 0.007},
        {"ticker": "JNJ", "name": "Johnson & Johnson", "industry": "Pharmaceuticals", "market_cap": 380e9, "pe": 18.0, "div_yield": 0.030},
        {"ticker": "ABBV", "name": "AbbVie Inc.", "industry": "Biotechnology", "market_cap": 310e9, "pe": 20.0, "div_yield": 0.035},
        {"ticker": "MRK", "name": "Merck & Co.", "industry": "Pharmaceuticals", "market_cap": 290e9, "pe": 16.0, "div_yield": 0.025},
    ],
    "Financials": [
        {"ticker": "JPM", "name": "JPMorgan Chase & Co.", "industry": "Diversified Banks", "market_cap": 580e9, "pe": 12.5, "div_yield": 0.022},
        {"ticker": "V", "name": "Visa Inc.", "industry": "Payment Processing", "market_cap": 550e9, "pe": 30.0, "div_yield": 0.007},
        {"ticker": "MA", "name": "Mastercard Inc.", "industry": "Payment Processing", "market_cap": 420e9, "pe": 33.0, "div_yield": 0.005},
        {"ticker": "BAC", "name": "Bank of America Corp.", "industry": "Diversified Banks", "market_cap": 310e9, "pe": 11.0, "div_yield": 0.025},
        {"ticker": "GS", "name": "Goldman Sachs Group", "industry": "Investment Banking", "market_cap": 150e9, "pe": 14.0, "div_yield": 0.022},
    ],
    "Consumer Discretionary": [
        {"ticker": "AMZN", "name": "Amazon.com Inc.", "industry": "E-Commerce", "market_cap": 1.9e12, "pe": 45.0, "div_yield": 0.0},
        {"ticker": "TSLA", "name": "Tesla Inc.", "industry": "Auto Manufacturers", "market_cap": 800e9, "pe": 60.0, "div_yield": 0.0},
        {"ticker": "HD", "name": "Home Depot Inc.", "industry": "Home Improvement", "market_cap": 370e9, "pe": 24.0, "div_yield": 0.024},
        {"ticker": "MCD", "name": "McDonald's Corp.", "industry": "Restaurants", "market_cap": 210e9, "pe": 25.0, "div_yield": 0.022},
        {"ticker": "NKE", "name": "Nike Inc.", "industry": "Footwear & Apparel", "market_cap": 140e9, "pe": 28.0, "div_yield": 0.015},
    ],
    "Communication Services": [
        {"ticker": "GOOGL", "name": "Alphabet Inc.", "industry": "Internet Services", "market_cap": 2.0e12, "pe": 22.0, "div_yield": 0.004},
        {"ticker": "META", "name": "Meta Platforms Inc.", "industry": "Social Media", "market_cap": 1.3e12, "pe": 24.0, "div_yield": 0.003},
        {"ticker": "NFLX", "name": "Netflix Inc.", "industry": "Streaming Entertainment", "market_cap": 350e9, "pe": 40.0, "div_yield": 0.0},
        {"ticker": "DIS", "name": "Walt Disney Co.", "industry": "Entertainment", "market_cap": 200e9, "pe": 32.0, "div_yield": 0.008},
        {"ticker": "CMCSA", "name": "Comcast Corp.", "industry": "Cable & Satellite", "market_cap": 160e9, "pe": 10.0, "div_yield": 0.030},
    ],
    "Industrials": [
        {"ticker": "GE", "name": "GE Aerospace", "industry": "Aerospace & Defense", "market_cap": 200e9, "pe": 30.0, "div_yield": 0.006},
        {"ticker": "CAT", "name": "Caterpillar Inc.", "industry": "Construction Machinery", "market_cap": 180e9, "pe": 18.0, "div_yield": 0.016},
        {"ticker": "HON", "name": "Honeywell Intl.", "industry": "Industrial Conglomerates", "market_cap": 140e9, "pe": 22.0, "div_yield": 0.020},
        {"ticker": "UNP", "name": "Union Pacific Corp.", "industry": "Railroads", "market_cap": 150e9, "pe": 23.0, "div_yield": 0.021},
        {"ticker": "RTX", "name": "RTX Corp.", "industry": "Aerospace & Defense", "market_cap": 150e9, "pe": 20.0, "div_yield": 0.022},
    ],
    "Consumer Staples": [
        {"ticker": "WMT", "name": "Walmart Inc.", "industry": "Hypermarkets", "market_cap": 500e9, "pe": 28.0, "div_yield": 0.013},
        {"ticker": "PG", "name": "Procter & Gamble Co.", "industry": "Personal Products", "market_cap": 380e9, "pe": 26.0, "div_yield": 0.024},
        {"ticker": "COST", "name": "Costco Wholesale", "industry": "Warehouse Clubs", "market_cap": 350e9, "pe": 48.0, "div_yield": 0.005},
        {"ticker": "KO", "name": "Coca-Cola Co.", "industry": "Beverages", "market_cap": 270e9, "pe": 24.0, "div_yield": 0.030},
        {"ticker": "PEP", "name": "PepsiCo Inc.", "industry": "Beverages & Snacks", "market_cap": 220e9, "pe": 22.0, "div_yield": 0.032},
    ],
    "Energy": [
        {"ticker": "XOM", "name": "Exxon Mobil Corp.", "industry": "Integrated Oil & Gas", "market_cap": 480e9, "pe": 13.0, "div_yield": 0.034},
        {"ticker": "CVX", "name": "Chevron Corp.", "industry": "Integrated Oil & Gas", "market_cap": 300e9, "pe": 12.0, "div_yield": 0.040},
        {"ticker": "COP", "name": "ConocoPhillips", "industry": "Exploration & Production", "market_cap": 140e9, "pe": 11.0, "div_yield": 0.018},
        {"ticker": "SLB", "name": "Schlumberger Ltd.", "industry": "Oilfield Services", "market_cap": 65e9, "pe": 14.0, "div_yield": 0.022},
        {"ticker": "EOG", "name": "EOG Resources Inc.", "industry": "Exploration & Production", "market_cap": 70e9, "pe": 10.0, "div_yield": 0.028},
    ],
    "Utilities": [
        {"ticker": "NEE", "name": "NextEra Energy Inc.", "industry": "Electric Utilities", "market_cap": 160e9, "pe": 25.0, "div_yield": 0.026},
        {"ticker": "DUK", "name": "Duke Energy Corp.", "industry": "Electric Utilities", "market_cap": 85e9, "pe": 18.0, "div_yield": 0.038},
        {"ticker": "SO", "name": "Southern Company", "industry": "Electric Utilities", "market_cap": 90e9, "pe": 20.0, "div_yield": 0.035},
        {"ticker": "D", "name": "Dominion Energy Inc.", "industry": "Electric Utilities", "market_cap": 45e9, "pe": 15.0, "div_yield": 0.050},
        {"ticker": "AEP", "name": "American Electric Power", "industry": "Electric Utilities", "market_cap": 50e9, "pe": 17.0, "div_yield": 0.036},
    ],
    "Real Estate": [
        {"ticker": "PLD", "name": "Prologis Inc.", "industry": "Industrial REITs", "market_cap": 110e9, "pe": 40.0, "div_yield": 0.030},
        {"ticker": "AMT", "name": "American Tower Corp.", "industry": "Telecom Tower REITs", "market_cap": 95e9, "pe": 38.0, "div_yield": 0.032},
        {"ticker": "EQIX", "name": "Equinix Inc.", "industry": "Data Center REITs", "market_cap": 80e9, "pe": 75.0, "div_yield": 0.018},
        {"ticker": "CCI", "name": "Crown Castle Intl.", "industry": "Telecom Tower REITs", "market_cap": 45e9, "pe": 30.0, "div_yield": 0.055},
        {"ticker": "PSA", "name": "Public Storage", "industry": "Self-Storage REITs", "market_cap": 55e9, "pe": 28.0, "div_yield": 0.040},
    ],
    "Materials": [
        {"ticker": "LIN", "name": "Linde PLC", "industry": "Industrial Gases", "market_cap": 210e9, "pe": 32.0, "div_yield": 0.012},
        {"ticker": "APD", "name": "Air Products & Chemicals", "industry": "Industrial Gases", "market_cap": 65e9, "pe": 25.0, "div_yield": 0.024},
        {"ticker": "SHW", "name": "Sherwin-Williams Co.", "industry": "Paints & Coatings", "market_cap": 85e9, "pe": 30.0, "div_yield": 0.009},
        {"ticker": "FCX", "name": "Freeport-McMoRan Inc.", "industry": "Copper Mining", "market_cap": 60e9, "pe": 20.0, "div_yield": 0.015},
        {"ticker": "NEM", "name": "Newmont Corp.", "industry": "Gold Mining", "market_cap": 50e9, "pe": 16.0, "div_yield": 0.035},
    ],
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def generate_suggestions(
    db: Session,
    job_id: str,
    user_id: str,
    holdings: list[Holding],
) -> list[StockSuggestion]:
    """Generate stock suggestions based on sector-gap analysis.

    Compares portfolio sector allocation against S&P 500 sector weights.
    For each underweight sector, suggests top stocks that are not already
    in the portfolio.
    """
    # Compute portfolio sector weights
    total_cost = sum(h.shares * h.buy_price for h in holdings) if holdings else 0
    portfolio_sector_weights: dict[str, float] = {}
    portfolio_tickers = {h.ticker.upper() for h in holdings}

    for h in holdings:
        sector = get_sector(h.ticker)
        cost_basis = h.shares * h.buy_price
        weight = cost_basis / total_cost if total_cost > 0 else 0
        portfolio_sector_weights[sector] = portfolio_sector_weights.get(sector, 0.0) + weight

    # Find underweight sectors (where portfolio weight is significantly below S&P 500)
    suggestions: list[StockSuggestion] = []
    gap_threshold = 0.02  # At least 2% gap to be considered underweight

    for sector, sp500_weight in SP500_SECTOR_WEIGHTS.items():
        portfolio_weight = portfolio_sector_weights.get(sector, 0.0)
        gap = sp500_weight - portfolio_weight

        if gap < gap_threshold:
            continue

        # Get candidate stocks not already in portfolio
        candidates = SECTOR_TOP_STOCKS.get(sector, [])
        available = [c for c in candidates if c["ticker"] not in portfolio_tickers]

        if not available:
            continue

        # Suggest top 1-2 stocks from this sector
        for stock in available[:2]:
            suggested_weight = round(min(gap / 2, 0.05), 4)  # Split gap, cap at 5%
            suggested_shares = None
            if stock.get("market_cap") and total_cost > 0:
                target_value = total_cost * suggested_weight
                estimated_price = stock.get("market_cap", 0) / 1e9 * 0.1  # Very rough
                # Use a more realistic price estimation
                estimated_price = stock.get("pe", 25) * 5  # Rough heuristic
                if estimated_price > 0:
                    suggested_shares = round(target_value / estimated_price, 2)

            rationale = (
                f"Your portfolio has {portfolio_weight:.1%} allocation to {sector}, "
                f"which is {gap:.1%} below the S&P 500 weight of {sp500_weight:.1%}. "
                f"{stock['name']} is a leading company in {stock.get('industry', sector)} "
                f"with a market cap of ${stock['market_cap']/1e9:.0f}B."
            )

            suggestion = StockSuggestion(
                id=str(uuid.uuid4()),
                job_id=job_id,
                user_id=user_id,
                ticker=stock["ticker"],
                company_name=stock["name"],
                sector=sector,
                industry=stock.get("industry"),
                rationale=rationale,
                gap_type="sector_gap",
                current_price=None,
                market_cap=stock.get("market_cap"),
                pe_ratio=stock.get("pe"),
                dividend_yield=stock.get("div_yield"),
                suggested_weight=suggested_weight,
                suggested_shares=suggested_shares,
                status="pending",
                created_at=_now(),
            )
            db.add(suggestion)
            suggestions.append(suggestion)

    db.commit()
    logger.info("Generated %d stock suggestions for job %s", len(suggestions), job_id)
    return suggestions
