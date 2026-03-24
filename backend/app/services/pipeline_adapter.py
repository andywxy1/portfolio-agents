"""TradingAgents pipeline adapter for portfolio-aware analysis.

Wraps the TradingAgents LangGraph pipeline to provide three analysis
depth tiers (heavy, medium, light) driven by portfolio weight.  Each
tier selects a different subset of analysts and debate configuration,
then extracts a structured result dict from the graph's final state.

The adapter creates a fresh TradingAgentsGraph per invocation to
avoid state leakage between tickers.  All calls are synchronous --
they are expected to be invoked from a background thread.
"""

import logging
import os
import traceback
from datetime import date
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Analyst sets per tier
# ---------------------------------------------------------------------------
_ANALYSTS_HEAVY = ["market", "social", "news", "fundamentals"]
_ANALYSTS_MEDIUM = ["market", "fundamentals"]
_ANALYSTS_LIGHT = ["fundamentals"]


def _build_graph_config(
    *,
    max_debate_rounds: int = 1,
    max_risk_discuss_rounds: int = 1,
) -> dict[str, Any]:
    """Build a TradingAgentsGraph config dict pointing at the LLM proxy.

    Merges with the TradingAgents DEFAULT_CONFIG to ensure all required
    keys are present (e.g. project_dir, data_cache_dir, results_dir).
    """
    try:
        from tradingagents.default_config import DEFAULT_CONFIG
        base = dict(DEFAULT_CONFIG)
    except ImportError:
        base = {}

    base.update({
        "llm_provider": "ollama",
        "backend_url": settings.llm_base_url,
        "deep_think_llm": settings.llm_deep_model,
        "quick_think_llm": settings.llm_quick_model,
        "max_debate_rounds": max_debate_rounds,
        "max_risk_discuss_rounds": max_risk_discuss_rounds,
        "max_recur_limit": 100,
        "data_vendors": {
            "core_stock_apis": "yfinance",
            "technical_indicators": "yfinance",
            "fundamental_data": "yfinance",
            "news_data": "yfinance",
        },
        "tool_vendors": {},
    })
    return base


def _ensure_env() -> None:
    """Set environment variables required by the OpenAI SDK / TradingAgents.

    The ``ollama`` provider in TradingAgents reads ``OLLAMA_API_KEY`` from
    the environment.  The underlying OpenAI SDK also needs
    ``OPENAI_API_KEY`` to be set (even though the request goes to the
    proxy).  We use ``setdefault`` so that explicit env vars are not
    overwritten.
    """
    api_key = settings.llm_api_key or settings.openai_api_key
    if api_key:
        os.environ.setdefault("OPENAI_API_KEY", api_key)
        os.environ.setdefault("OLLAMA_API_KEY", api_key)


def _extract_result(
    final_state: dict[str, Any],
    decision: str,
) -> dict[str, Any]:
    """Extract a structured result dict from the graph's final state.

    The shape matches what ``analysis_runner`` and the database schema
    expect: individual report strings, debate summaries, signal, and
    the raw trade decision text.
    """
    # Investment debate sub-state
    inv_debate = final_state.get("investment_debate_state") or {}
    # Handle both TypedDict and plain-dict access
    if hasattr(inv_debate, "get"):
        investment_debate: dict[str, Any] = {
            "bull_case": inv_debate.get("bull_history", ""),
            "bear_case": inv_debate.get("bear_history", ""),
            "debate_history": inv_debate.get("history", ""),
            "judge_decision": inv_debate.get("judge_decision", ""),
        }
    else:
        investment_debate = {}

    # Risk debate sub-state
    risk_state = final_state.get("risk_debate_state") or {}
    if hasattr(risk_state, "get"):
        risk_debate: dict[str, Any] = {
            "aggressive_view": risk_state.get("aggressive_history", ""),
            "conservative_view": risk_state.get("conservative_history", ""),
            "neutral_view": risk_state.get("neutral_history", ""),
            "debate_history": risk_state.get("history", ""),
            "judge_decision": risk_state.get("judge_decision", ""),
        }
    else:
        risk_debate = {}

    # Normalise the decision string to one of the canonical signals.
    signal = _normalise_signal(decision)

    return {
        "signal": signal,
        "raw_decision": final_state.get("final_trade_decision", ""),
        "market_report": final_state.get("market_report") or None,
        "sentiment_report": final_state.get("sentiment_report") or None,
        "news_report": final_state.get("news_report") or None,
        "fundamentals_report": final_state.get("fundamentals_report") or None,
        "investment_debate": investment_debate or None,
        "risk_debate": risk_debate or None,
        "investment_plan": (
            final_state.get("investment_plan")
            or final_state.get("trader_investment_plan")
            or None
        ),
    }


def _normalise_signal(raw: str) -> str:
    """Map the signal processor output to a canonical label.

    Accepted canonical values: BUY, OVERWEIGHT, HOLD, UNDERWEIGHT, SELL.
    Anything unrecognised falls back to HOLD.
    """
    if not raw:
        return "HOLD"
    cleaned = raw.strip().upper()
    canonical = {"BUY", "OVERWEIGHT", "HOLD", "UNDERWEIGHT", "SELL"}
    # The signal processor sometimes returns multi-word; take the first token
    for token in cleaned.split():
        if token in canonical:
            return token
    # Substring fallback for edge cases like "**BUY**"
    for label in canonical:
        if label in cleaned:
            return label
    return "HOLD"


def _error_result(ticker: str, error: Exception) -> dict[str, Any]:
    """Return a minimal result dict when analysis fails."""
    tb = traceback.format_exception(type(error), error, error.__traceback__)
    error_detail = "".join(tb[-3:])
    logger.error("Pipeline error for %s: %s", ticker, error_detail)
    return {
        "signal": "ERROR",
        "raw_decision": f"Analysis failed for {ticker}: {error}",
        "error": str(error),
        "error_detail": error_detail,
        "market_report": None,
        "sentiment_report": None,
        "news_report": None,
        "fundamentals_report": None,
        "investment_debate": None,
        "risk_debate": None,
        "investment_plan": None,
    }


class PipelineAdapter:
    """Wraps TradingAgentsGraph for portfolio analysis with tiered depth.

    Each ``analyze_*`` method is **synchronous** and expected to be called
    from a background thread managed by ``AnalysisRunner``.

    Tier mapping
    ------------
    * heavy  (weight >= 10%) -- all 4 analysts, full debates
    * medium (weight 3-10%)  -- market + fundamentals, 1 debate round
    * light  (weight < 3%)   -- fundamentals only, no debate
    """

    def __init__(self) -> None:
        _ensure_env()

    # ------------------------------------------------------------------
    # Public tier methods
    # ------------------------------------------------------------------

    def analyze_heavy(
        self,
        ticker: str,
        trade_date: Optional[str] = None,
    ) -> dict[str, Any]:
        """Full analysis: all 4 analysts + full debate rounds."""
        trade_date = trade_date or _today()
        logger.info("[heavy] Starting full analysis for %s @ %s", ticker, trade_date)
        return self._run(
            ticker=ticker,
            trade_date=trade_date,
            analysts=_ANALYSTS_HEAVY,
            max_debate_rounds=settings.max_debate_rounds,
            max_risk_discuss_rounds=settings.max_risk_discuss_rounds,
        )

    def analyze_medium(
        self,
        ticker: str,
        trade_date: Optional[str] = None,
    ) -> dict[str, Any]:
        """Reduced analysis: market + fundamentals, 1 debate round."""
        trade_date = trade_date or _today()
        logger.info(
            "[medium] Starting standard analysis for %s @ %s", ticker, trade_date
        )
        return self._run(
            ticker=ticker,
            trade_date=trade_date,
            analysts=_ANALYSTS_MEDIUM,
            max_debate_rounds=1,
            max_risk_discuss_rounds=1,
        )

    def analyze_light(
        self,
        ticker: str,
        trade_date: Optional[str] = None,
    ) -> dict[str, Any]:
        """Minimal analysis: fundamentals only, no debate."""
        trade_date = trade_date or _today()
        logger.info("[light] Starting quick analysis for %s @ %s", ticker, trade_date)
        return self._run(
            ticker=ticker,
            trade_date=trade_date,
            analysts=_ANALYSTS_LIGHT,
            max_debate_rounds=0,
            max_risk_discuss_rounds=0,
        )

    # ------------------------------------------------------------------
    # Convenience dispatcher used by analysis_runner
    # ------------------------------------------------------------------

    def analyze_ticker(
        self,
        ticker: str,
        depth: str = "full",
        trade_date: Optional[str] = None,
    ) -> dict[str, Any]:
        """Dispatch to the appropriate tier method by depth label.

        Accepted depth values: ``"full"`` / ``"heavy"``,
        ``"standard"`` / ``"medium"``, ``"quick"`` / ``"light"``.
        """
        dispatch = {
            "full": self.analyze_heavy,
            "heavy": self.analyze_heavy,
            "standard": self.analyze_medium,
            "medium": self.analyze_medium,
            "quick": self.analyze_light,
            "light": self.analyze_light,
        }
        method = dispatch.get(depth, self.analyze_medium)
        return method(ticker, trade_date)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run(
        self,
        *,
        ticker: str,
        trade_date: str,
        analysts: list[str],
        max_debate_rounds: int,
        max_risk_discuss_rounds: int,
    ) -> dict[str, Any]:
        """Instantiate a fresh graph, run propagation, return structured results."""
        try:
            from tradingagents.graph.trading_graph import TradingAgentsGraph

            config = _build_graph_config(
                max_debate_rounds=max_debate_rounds,
                max_risk_discuss_rounds=max_risk_discuss_rounds,
            )

            graph = TradingAgentsGraph(
                selected_analysts=analysts,
                debug=False,
                config=config,
            )

            final_state, decision = graph.propagate(ticker, trade_date)

            result = _extract_result(final_state, decision)
            logger.info(
                "Analysis complete for %s: signal=%s",
                ticker,
                result["signal"],
            )
            return result

        except Exception as exc:
            return _error_result(ticker, exc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _today() -> str:
    """Return today's date as YYYY-MM-DD string."""
    return date.today().isoformat()
