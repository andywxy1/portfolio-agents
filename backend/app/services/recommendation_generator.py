"""Structured order recommendation generator.

Uses LLM function calling to produce validated ``OrderRecommendation``
objects from portfolio analysis results.  The LLM receives a summary of
every position analysis, portfolio allocation data, and concentration
metrics, then returns one or more structured recommendations via a
tool/function call.

All LLM calls go through the OpenAI-compatible proxy configured in
``app.config.settings``.
"""

import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# OrderRecommendation tool schema (for LLM function calling)
# ---------------------------------------------------------------------------

ORDER_RECOMMENDATION_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_order_recommendations",
        "description": (
            "Submit one or more order recommendations based on portfolio analysis. "
            "Each recommendation specifies a concrete, actionable trade."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "recommendations": {
                    "type": "array",
                    "description": "List of order recommendations",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ticker": {
                                "type": "string",
                                "description": "Stock ticker symbol",
                            },
                            "order_type": {
                                "type": "string",
                                "enum": [
                                    "market",
                                    "limit",
                                    "stop",
                                    "stop_limit",
                                    "conditional",
                                ],
                                "description": "Order type",
                            },
                            "side": {
                                "type": "string",
                                "enum": ["buy", "sell"],
                                "description": "Buy or sell",
                            },
                            "limit_price": {
                                "type": "number",
                                "description": "Limit price (required for limit/stop_limit orders)",
                            },
                            "stop_price": {
                                "type": "number",
                                "description": "Stop price (required for stop/stop_limit orders)",
                            },
                            "quantity": {
                                "type": "number",
                                "description": "Suggested number of shares",
                            },
                            "time_in_force": {
                                "type": "string",
                                "enum": ["day", "gtc", "ioc"],
                                "description": "Time in force for the order",
                            },
                            "expiration": {
                                "type": "string",
                                "description": "ISO date for order expiration (YYYY-MM-DD)",
                            },
                            "confidence": {
                                "type": "number",
                                "description": "Confidence score between 0 and 1",
                            },
                            "priority": {
                                "type": "string",
                                "enum": ["high", "medium", "low"],
                                "description": "Priority level of this recommendation",
                            },
                            "rationale": {
                                "type": "string",
                                "description": "Explanation of why this trade is recommended",
                            },
                            "conditions": {
                                "type": "string",
                                "description": "Conditions under which this order should be placed",
                            },
                        },
                        "required": [
                            "ticker",
                            "order_type",
                            "side",
                            "confidence",
                            "priority",
                            "rationale",
                        ],
                    },
                },
            },
            "required": ["recommendations"],
        },
    },
}


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a portfolio risk manager and trading strategist.  You have been
given the results of a multi-agent analysis for every position in the
user's portfolio, along with portfolio-level allocation and concentration
data.

Your task is to produce **concrete, actionable order recommendations**.
For each recommendation, specify exact order parameters: ticker, side
(buy/sell), order type, quantity, limit/stop prices where appropriate,
time-in-force, and a confidence score.

Guidelines:
- Only recommend trades where the analysis provides a clear directional
  signal.  Do NOT recommend trades for HOLD signals unless there is a
  compelling rebalancing or risk-reduction reason.
- For limit orders, set the limit price within 10% of the current price.
- For stop orders, set the stop price to protect against further downside
  (typically 5-15% below current price for sells, above for buys).
- Prefer "gtc" (good-till-cancelled) for swing trades and "day" for
  intraday entries.
- Set expiration no more than 90 days out.
- Confidence should reflect the strength and agreement of the underlying
  analysis (0.0 = no confidence, 1.0 = very high confidence).
- Priority: "high" for risk-critical or time-sensitive trades, "medium"
  for beneficial-but-not-urgent, "low" for opportunistic or nice-to-have.
- If no trades are warranted, return an empty recommendations array.

Call the ``submit_order_recommendations`` function with your recommendations.
"""


def _build_user_prompt(
    position_summaries: list[dict[str, Any]],
    allocation: list[dict[str, Any]],
    concentration: dict[str, Any],
    sector_breakdown: list[dict[str, Any]],
) -> str:
    """Assemble the user-turn content for the recommendation LLM call."""
    parts: list[str] = []

    parts.append("## Per-Position Analysis Summaries\n")
    for ps in position_summaries:
        ticker = ps.get("ticker", "???")
        signal = ps.get("signal", "N/A")
        depth = ps.get("depth", "unknown")
        raw = ps.get("raw_decision", "")
        # Truncate very long decisions to keep context manageable
        if len(raw) > 800:
            raw = raw[:800] + "..."
        parts.append(
            f"### {ticker}  (depth={depth}, signal={signal})\n{raw}\n"
        )

    parts.append("\n## Portfolio Allocation\n")
    parts.append("| Ticker | Shares | Buy Price | Current Price | Weight | P&L % |")
    parts.append("|--------|--------|-----------|---------------|--------|-------|")
    for a in allocation:
        parts.append(
            f"| {a.get('ticker', '?')} "
            f"| {a.get('shares', '?')} "
            f"| {a.get('buy_price', '?')} "
            f"| {a.get('current_price', 'N/A')} "
            f"| {_fmt_pct(a.get('weight'))} "
            f"| {_fmt_pct(a.get('pnl_pct'))} |"
        )

    parts.append("\n## Concentration Metrics\n")
    parts.append(f"- HHI: {concentration.get('hhi', 'N/A')}")
    parts.append(f"- Top-3 weight: {_fmt_pct(concentration.get('top3_weight'))}")
    parts.append(f"- Top-5 weight: {_fmt_pct(concentration.get('top5_weight'))}")
    parts.append(
        f"- Max position: {concentration.get('max_position_ticker', '?')} "
        f"at {_fmt_pct(concentration.get('max_position_weight'))}"
    )

    parts.append("\n## Sector Breakdown\n")
    for s in sector_breakdown:
        parts.append(
            f"- {s.get('sector', '?')}: {_fmt_pct(s.get('weight'))} "
            f"({', '.join(s.get('tickers', []))})"
        )

    return "\n".join(parts)


def _fmt_pct(value: Any) -> str:
    """Format a float as a percentage string, handling None."""
    if value is None:
        return "N/A"
    try:
        return f"{float(value):.1%}"
    except (TypeError, ValueError):
        return str(value)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_MAX_EXPIRATION_DAYS = 90
_MAX_LIMIT_PRICE_DEVIATION = 0.10  # 10%
_PRIORITY_MAP = {"high": 3, "medium": 2, "low": 1}


def _validate_recommendation(
    rec: dict[str, Any],
    current_prices: dict[str, float],
) -> tuple[bool, list[str]]:
    """Validate a single recommendation dict.

    Returns ``(is_valid, list_of_issues)``.  If ``is_valid`` is False,
    the recommendation should be discarded or adjusted.
    """
    issues: list[str] = []
    ticker = rec.get("ticker", "")

    # -- Required fields --
    if not ticker:
        issues.append("Missing ticker")
    if rec.get("side") not in ("buy", "sell"):
        issues.append(f"Invalid side: {rec.get('side')}")
    if rec.get("order_type") not in (
        "market",
        "limit",
        "stop",
        "stop_limit",
        "conditional",
    ):
        issues.append(f"Invalid order_type: {rec.get('order_type')}")

    # -- Confidence clamping --
    conf = rec.get("confidence")
    if conf is not None:
        try:
            conf = float(conf)
            rec["confidence"] = max(0.0, min(1.0, conf))
        except (TypeError, ValueError):
            issues.append(f"Invalid confidence: {conf}")

    # -- Limit price within 10% of current price --
    current = current_prices.get(ticker.upper())
    limit_price = rec.get("limit_price")
    if limit_price is not None and current is not None:
        try:
            deviation = abs(float(limit_price) - current) / current
            if deviation > _MAX_LIMIT_PRICE_DEVIATION:
                issues.append(
                    f"Limit price {limit_price} deviates {deviation:.1%} from "
                    f"current price {current} (max {_MAX_LIMIT_PRICE_DEVIATION:.0%})"
                )
        except (TypeError, ValueError, ZeroDivisionError):
            pass

    # -- Expiration max 90 days --
    expiration = rec.get("expiration")
    if expiration:
        try:
            exp_date = date.fromisoformat(expiration)
            max_date = date.today() + timedelta(days=_MAX_EXPIRATION_DAYS)
            if exp_date > max_date:
                issues.append(
                    f"Expiration {expiration} exceeds {_MAX_EXPIRATION_DAYS}-day maximum"
                )
        except ValueError:
            issues.append(f"Invalid expiration date format: {expiration}")

    # -- Quantity must be positive --
    qty = rec.get("quantity")
    if qty is not None:
        try:
            if float(qty) <= 0:
                issues.append(f"Quantity must be positive, got {qty}")
        except (TypeError, ValueError):
            issues.append(f"Invalid quantity: {qty}")

    return len(issues) == 0, issues


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def generate_recommendations(
    position_summaries: list[dict[str, Any]],
    allocation: list[dict[str, Any]],
    concentration: dict[str, Any],
    sector_breakdown: list[dict[str, Any]],
    current_prices: dict[str, float],
) -> list[dict[str, Any]]:
    """Generate validated order recommendations via LLM function calling.

    Parameters
    ----------
    position_summaries
        One entry per analysed ticker, containing at least ``ticker``,
        ``signal``, ``depth``, and ``raw_decision``.
    allocation
        Portfolio allocation entries (ticker, shares, weight, etc.).
    concentration
        HHI and top-N concentration metrics.
    sector_breakdown
        Sector weight entries.
    current_prices
        Map of ticker -> current price (used for limit-price validation).

    Returns
    -------
    list[dict]
        Validated recommendation dicts ready for database storage.
    """
    if not position_summaries:
        logger.info("No position summaries provided; skipping recommendation generation")
        return []

    try:
        from langchain_openai import ChatOpenAI

        # Ensure env var is set for the OpenAI SDK
        os.environ.setdefault("OPENAI_API_KEY", settings.llm_api_key)

        llm = ChatOpenAI(
            model=settings.llm_deep_model,
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            temperature=0.2,
        )

        user_prompt = _build_user_prompt(
            position_summaries, allocation, concentration, sector_breakdown
        )

        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        # Invoke with tool binding
        llm_with_tools = llm.bind_tools(
            [ORDER_RECOMMENDATION_TOOL["function"]],
            tool_choice={"type": "function", "function": {"name": "submit_order_recommendations"}},
        )
        response = llm_with_tools.invoke(messages)

        # Extract tool calls from the response
        raw_recs = _extract_recommendations_from_response(response)

        # Validate each recommendation
        validated: list[dict[str, Any]] = []
        for rec in raw_recs:
            is_valid, issues = _validate_recommendation(rec, current_prices)
            if is_valid:
                # Normalise priority to integer for database storage
                rec["priority_label"] = rec.get("priority", "medium")
                rec["priority"] = _PRIORITY_MAP.get(
                    rec.get("priority", "medium"), 1
                )
                validated.append(rec)
            else:
                logger.warning(
                    "Dropping invalid recommendation for %s: %s",
                    rec.get("ticker", "?"),
                    "; ".join(issues),
                )

        logger.info(
            "Generated %d recommendations (%d validated of %d raw)",
            len(validated),
            len(validated),
            len(raw_recs),
        )
        return validated

    except Exception:
        logger.exception("Failed to generate recommendations via LLM")
        return []


def _extract_recommendations_from_response(response: Any) -> list[dict[str, Any]]:
    """Parse recommendation dicts from an LLM response with tool calls."""
    recs: list[dict[str, Any]] = []

    # langchain_openai returns tool_calls on the AIMessage
    tool_calls = getattr(response, "tool_calls", None) or []
    for call in tool_calls:
        args = call.get("args", {}) if isinstance(call, dict) else {}
        items = args.get("recommendations", [])
        if isinstance(items, list):
            recs.extend(items)

    # Fallback: try parsing from additional_kwargs (older langchain versions)
    if not recs:
        additional = getattr(response, "additional_kwargs", {}) or {}
        for tc in additional.get("tool_calls", []):
            try:
                fn_args = tc.get("function", {}).get("arguments", "{}")
                parsed = json.loads(fn_args) if isinstance(fn_args, str) else fn_args
                items = parsed.get("recommendations", [])
                if isinstance(items, list):
                    recs.extend(items)
            except (json.JSONDecodeError, AttributeError):
                continue

    # Last resort: try parsing the content as JSON
    if not recs:
        content = getattr(response, "content", "")
        if content:
            try:
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    recs = parsed
                elif isinstance(parsed, dict) and "recommendations" in parsed:
                    recs = parsed["recommendations"]
            except (json.JSONDecodeError, TypeError):
                pass

    return recs
