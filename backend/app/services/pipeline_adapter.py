"""TradingAgents pipeline adapter for portfolio-aware analysis.

Wraps the TradingAgents LangGraph pipeline to provide three analysis
depth tiers (heavy, medium, light) driven by portfolio weight.  Each
tier selects a different subset of analysts and debate configuration,
then extracts a structured result dict from the graph's final state.

The adapter creates a fresh TradingAgentsGraph per invocation to
avoid state leakage between tickers.  All calls are synchronous --
they are expected to be invoked from a background thread.
"""

from __future__ import annotations

import logging
import os
import traceback
from datetime import date
from typing import TYPE_CHECKING, Any, Callable, Optional

from langchain_core.callbacks import BaseCallbackHandler

from app.config import settings

if TYPE_CHECKING:
    from app.services.event_stream import AnalysisEventStream


class AnalysisCancelledError(Exception):
    """Raised when an analysis is cancelled mid-execution."""
    pass

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LangChain callback handler for streaming events
# ---------------------------------------------------------------------------


class _StreamingCallbackHandler(BaseCallbackHandler):
    """Emits fine-grained events for LLM and tool activity.

    Attached to the LLM clients (via the TradingAgentsGraph ``callbacks``
    parameter) and to the graph runtime config (for tool nodes).  This
    provides live updates even when the graph stream itself only fires
    once per completed node.

    Also checks for cancellation at LLM boundaries (start/end) so that
    long-running LLM calls can be interrupted without waiting for the
    next graph.stream() chunk.
    """

    def __init__(
        self,
        event_stream: AnalysisEventStream,
        ticker: str,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> None:
        super().__init__()
        self.stream = event_stream
        self.ticker = ticker
        self.cancel_check = cancel_check
        # Track current agent for context (set externally by the streaming loop)
        self.current_agent: str = ""

    # -- LLM events ---------------------------------------------------------

    def on_llm_start(
        self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any
    ) -> None:
        # Check for cancellation before the LLM call begins
        if self.cancel_check and self.cancel_check():
            raise AnalysisCancelledError(
                f"Analysis of {self.ticker} cancelled by user (on_llm_start)"
            )

        agent = self.current_agent or kwargs.get("name", "LLM")
        logger.debug("[callback] on_llm_start agent=%s", agent)
        self.stream.emit("agent_activity", {
            "agent": agent,
            "activity": "thinking",
            "ticker": self.ticker,
        })

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        # Check for cancellation as soon as the LLM response arrives
        if self.cancel_check and self.cancel_check():
            raise AnalysisCancelledError(
                f"Analysis of {self.ticker} cancelled by user (on_llm_end)"
            )

        agent = self.current_agent or "LLM"
        # Extract text from the response
        text = ""
        try:
            if hasattr(response, "generations") and response.generations:
                gen = response.generations[0]
                if isinstance(gen, list) and gen:
                    text = gen[0].text or ""
                elif hasattr(gen, "text"):
                    text = gen.text or ""
        except Exception:
            pass
        if text:
            self.stream.emit("agent_message", {
                "agent": agent,
                "content": text[:500],
                "ticker": self.ticker,
            })

    # -- Tool events --------------------------------------------------------

    def on_tool_start(
        self, serialized: dict[str, Any], input_str: str, **kwargs: Any
    ) -> None:
        tool_name = serialized.get("name", "") or kwargs.get("name", "tool")
        agent = self.current_agent or "Agent"
        logger.debug("[callback] on_tool_start tool=%s agent=%s", tool_name, agent)
        self.stream.emit("tool_call", {
            "agent": agent,
            "tool": tool_name,
            "params": input_str[:200] if isinstance(input_str, str) else str(input_str)[:200],
            "ticker": self.ticker,
        })

    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        agent = self.current_agent or "Agent"
        self.stream.emit("tool_result", {
            "agent": agent,
            "result_preview": str(output)[:300] if output else "",
            "ticker": self.ticker,
        })

# ---------------------------------------------------------------------------
# Analyst sets per tier
# ---------------------------------------------------------------------------
_ANALYSTS_HEAVY = ["market", "social", "news", "fundamentals"]
_ANALYSTS_MEDIUM = ["market", "social", "fundamentals"]
_ANALYSTS_LIGHT = ["fundamentals"]

# Map LangGraph node names (as defined in setup.py) to (team, display_name).
# Node names that are internal (tool calls, message clears) are excluded --
# they are filtered out during streaming so only meaningful agent steps are
# surfaced to the frontend.
_NODE_DISPLAY_MAP: dict[str, tuple[str, str]] = {
    "Market Analyst": ("Analyst Team", "Market Analyst"),
    "Social Analyst": ("Analyst Team", "Social Analyst"),
    "News Analyst": ("Analyst Team", "News Analyst"),
    "Fundamentals Analyst": ("Analyst Team", "Fundamentals Analyst"),
    "Bull Researcher": ("Research Team", "Bull Researcher"),
    "Bear Researcher": ("Research Team", "Bear Researcher"),
    "Research Manager": ("Research Team", "Research Manager"),
    "Trader": ("Trading Team", "Trader"),
    "Aggressive Analyst": ("Risk Management", "Aggressive Analyst"),
    "Neutral Analyst": ("Risk Management", "Neutral Analyst"),
    "Conservative Analyst": ("Risk Management", "Conservative Analyst"),
    "Portfolio Manager": ("Portfolio Management", "Portfolio Manager"),
}

# State keys that hold analyst reports.
_REPORT_KEYS = [
    "market_report",
    "sentiment_report",
    "news_report",
    "fundamentals_report",
]


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


def check_llm_connectivity(timeout: float = 10.0) -> None:
    """Verify the LLM proxy is reachable before starting analysis.

    Raises ``ConnectionError`` if the backend URL cannot be reached
    within *timeout* seconds.  This prevents analysis threads from
    hanging indefinitely when the LLM host is down.
    """
    import urllib.request
    import urllib.error

    url = settings.llm_base_url.rstrip("/") + "/models"
    api_key = settings.llm_api_key or settings.openai_api_key
    req = urllib.request.Request(url)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    try:
        urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        # 401/403 means the server is reachable but auth failed -- that is
        # fine here; the actual LLM call will surface the auth error.
        if exc.code in (401, 403):
            logger.debug("LLM proxy returned %d (auth issue) -- server is reachable", exc.code)
            return
        raise ConnectionError(
            f"LLM proxy at {settings.llm_base_url} returned HTTP {exc.code}"
        ) from exc
    except Exception as exc:
        raise ConnectionError(
            f"LLM proxy at {settings.llm_base_url} is unreachable: {exc}"
        ) from exc


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
        portfolio_context: Optional[dict[str, Any]] = None,
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
            portfolio_context=portfolio_context,
        )

    def analyze_medium(
        self,
        ticker: str,
        trade_date: Optional[str] = None,
        portfolio_context: Optional[dict[str, Any]] = None,
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
            portfolio_context=portfolio_context,
        )

    def analyze_light(
        self,
        ticker: str,
        trade_date: Optional[str] = None,
        portfolio_context: Optional[dict[str, Any]] = None,
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
            portfolio_context=portfolio_context,
        )

    # ------------------------------------------------------------------
    # Convenience dispatcher used by analysis_runner
    # ------------------------------------------------------------------

    def analyze_ticker(
        self,
        ticker: str,
        depth: str = "full",
        trade_date: Optional[str] = None,
        portfolio_context: Optional[dict[str, Any]] = None,
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
        return method(ticker, trade_date, portfolio_context=portfolio_context)

    # ------------------------------------------------------------------
    # Streaming variant (emits events to an AnalysisEventStream)
    # ------------------------------------------------------------------

    def analyze_ticker_streaming(
        self,
        ticker: str,
        depth: str = "full",
        trade_date: Optional[str] = None,
        event_stream: Optional[AnalysisEventStream] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
        portfolio_context: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Run analysis with live event streaming.

        Falls back to the non-streaming path when *event_stream* is None.

        Parameters
        ----------
        cancel_check
            Optional callable that returns ``True`` when the job has been
            cancelled.  Checked between graph stream chunks so that
            long-running single-ticker analyses can be interrupted.
        portfolio_context
            Optional dict with portfolio position data (shares, buy_price,
            current_price, pnl, pnl_pct, weight, total_value) to inject
            into the analysis so agents consider the user's position.
        """
        if event_stream is None:
            return self.analyze_ticker(ticker, depth, trade_date, portfolio_context=portfolio_context)

        trade_date = trade_date or _today()

        # Resolve analysts + debate config from depth
        depth_config = {
            "full": (_ANALYSTS_HEAVY, settings.max_debate_rounds, settings.max_risk_discuss_rounds),
            "heavy": (_ANALYSTS_HEAVY, settings.max_debate_rounds, settings.max_risk_discuss_rounds),
            "standard": (_ANALYSTS_MEDIUM, 1, 1),
            "medium": (_ANALYSTS_MEDIUM, 1, 1),
            "quick": (_ANALYSTS_LIGHT, 0, 0),
            "light": (_ANALYSTS_LIGHT, 0, 0),
        }
        analysts, debate_rounds, risk_rounds = depth_config.get(
            depth, (_ANALYSTS_MEDIUM, 1, 1)
        )

        return self._run_streaming(
            ticker=ticker,
            trade_date=trade_date,
            analysts=analysts,
            max_debate_rounds=debate_rounds,
            max_risk_discuss_rounds=risk_rounds,
            event_stream=event_stream,
            cancel_check=cancel_check,
            portfolio_context=portfolio_context,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run_streaming(
        self,
        *,
        ticker: str,
        trade_date: str,
        analysts: list[str],
        max_debate_rounds: int,
        max_risk_discuss_rounds: int,
        event_stream: AnalysisEventStream,
        cancel_check: Optional[Callable[[], bool]] = None,
        portfolio_context: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Stream the LangGraph execution, emitting events for each node.

        Uses ``stream_mode="updates"`` so each chunk is a dict mapping
        ``{node_name: state_delta}``.  The node name keys correspond
        exactly to the names registered in ``setup.py`` (e.g.
        ``"Market Analyst"``, ``"tools_market"``, ``"Bull Researcher"``).

        A ``_StreamingCallbackHandler`` is also attached to the LLM
        clients and graph runtime to capture fine-grained tool and LLM
        events that fire *within* a single node execution.
        """
        try:
            from tradingagents.graph.trading_graph import TradingAgentsGraph

            logger.info(
                "[streaming] Starting streaming analysis for %s depth=%s "
                "analysts=%s debate_rounds=%d risk_rounds=%d",
                ticker,
                "custom",
                analysts,
                max_debate_rounds,
                max_risk_discuss_rounds,
            )

            # Create callback handler for fine-grained LLM/tool events
            # Pass cancel_check so the handler can abort at LLM boundaries
            cb_handler = _StreamingCallbackHandler(
                event_stream, ticker, cancel_check=cancel_check
            )

            config = _build_graph_config(
                max_debate_rounds=max_debate_rounds,
                max_risk_discuss_rounds=max_risk_discuss_rounds,
            )

            graph_obj = TradingAgentsGraph(
                selected_analysts=analysts,
                debug=False,
                config=config,
                callbacks=[cb_handler],
            )

            # Build initial state
            init_state = graph_obj.propagator.create_initial_state(ticker, trade_date)

            # Inject portfolio context into initial messages so all agents
            # in the pipeline are aware of the user's position details
            if portfolio_context:
                context_msg = _build_portfolio_context_message(ticker, portfolio_context)
                if context_msg:
                    existing_messages = init_state.get("messages", [])
                    # Prepend context as a system message before the ticker message
                    init_state["messages"] = [("system", context_msg)] + list(existing_messages)

            # Override stream_mode to "updates" so chunks are {node_name: delta}
            # Also pass callbacks into the runtime config for tool nodes
            stream_config = {
                "recursion_limit": config.get("max_recur_limit", 100),
                "callbacks": [cb_handler],
            }

            # Accumulate state from deltas so we have the full final state
            accumulated_state: dict[str, Any] = dict(init_state)
            last_node: str | None = None
            chunk_count = 0

            logger.debug("[streaming] Beginning graph.stream() for %s", ticker)

            for chunk in graph_obj.graph.stream(
                init_state,
                stream_mode="updates",
                config=stream_config,
            ):
                chunk_count += 1

                # Check for cancellation between graph chunks
                if cancel_check is not None and cancel_check():
                    logger.info(
                        "[streaming] Cancellation detected for %s after %d chunks",
                        ticker,
                        chunk_count,
                    )
                    raise AnalysisCancelledError(
                        f"Analysis of {ticker} cancelled by user"
                    )

                # With stream_mode="updates", chunk is {node_name: state_delta}
                if not isinstance(chunk, dict):
                    logger.debug(
                        "[streaming] chunk #%d unexpected type: %s",
                        chunk_count,
                        type(chunk).__name__,
                    )
                    continue

                for node_name, state_delta in chunk.items():
                    logger.debug(
                        "[streaming] chunk #%d node=%r delta_keys=%s",
                        chunk_count,
                        node_name,
                        list(state_delta.keys()) if isinstance(state_delta, dict) else "N/A",
                    )

                    # Merge delta into accumulated state
                    if isinstance(state_delta, dict):
                        for key, val in state_delta.items():
                            # For messages, append rather than replace
                            if key == "messages" and isinstance(val, list):
                                existing = accumulated_state.get("messages", [])
                                if isinstance(existing, list):
                                    accumulated_state["messages"] = existing + val
                                else:
                                    accumulated_state["messages"] = val
                            else:
                                accumulated_state[key] = val

                    # Check if this is a display-worthy node
                    display = _NODE_DISPLAY_MAP.get(node_name)

                    if display is not None:
                        team, agent = display
                        cb_handler.current_agent = agent

                        # Emit stage transitions
                        if node_name != last_node:
                            # Close previous stage
                            if last_node and last_node in _NODE_DISPLAY_MAP:
                                prev_team, prev_agent = _NODE_DISPLAY_MAP[last_node]
                                event_stream.emit("stage_complete", {
                                    "team": prev_team,
                                    "agent": prev_agent,
                                    "ticker": ticker,
                                    "status": "completed",
                                })

                            # Resolve depth label for display from the
                            # analyst set: heavy->deep, medium->medium,
                            # light->light
                            if analysts == _ANALYSTS_HEAVY:
                                _depth_label = "deep"
                            elif analysts == _ANALYSTS_MEDIUM:
                                _depth_label = "medium"
                            else:
                                _depth_label = "light"

                            event_stream.emit("stage_start", {
                                "team": team,
                                "agent": agent,
                                "ticker": ticker,
                                "depth": _depth_label,
                            })
                            last_node = node_name

                        # Extract messages from the delta
                        if isinstance(state_delta, dict):
                            messages = state_delta.get("messages", [])
                            if messages:
                                msg = messages[-1]
                                content = getattr(msg, "content", None) or ""
                                tool_calls = getattr(msg, "tool_calls", None)

                                if tool_calls:
                                    for tc in tool_calls:
                                        tc_name = (
                                            tc.get("name", "")
                                            if isinstance(tc, dict)
                                            else getattr(tc, "name", "")
                                        )
                                        tc_args = (
                                            tc.get("args", {})
                                            if isinstance(tc, dict)
                                            else getattr(tc, "args", {})
                                        )
                                        event_stream.emit("tool_call", {
                                            "agent": agent,
                                            "tool": tc_name,
                                            "params": tc_args,
                                            "ticker": ticker,
                                        })
                                elif content:
                                    event_stream.emit("agent_message", {
                                        "agent": agent,
                                        "content": content[:500],
                                        "ticker": ticker,
                                    })

                            # Detect report additions in the delta
                            for report_key in _REPORT_KEYS:
                                new_val = state_delta.get(report_key)
                                if new_val:
                                    event_stream.emit("report", {
                                        "agent": agent,
                                        "report_type": report_key.replace("_report", ""),
                                        "content": (
                                            new_val[:2000]
                                            if isinstance(new_val, str)
                                            else str(new_val)[:2000]
                                        ),
                                        "ticker": ticker,
                                    })

                    else:
                        # Non-display node (tool node or message-clear node).
                        # Still log for diagnostics.
                        logger.debug(
                            "[streaming] skipping non-display node %r", node_name
                        )

            logger.info(
                "[streaming] graph.stream() finished for %s after %d chunks",
                ticker,
                chunk_count,
            )

            # Close the final stage
            if last_node and last_node in _NODE_DISPLAY_MAP:
                prev_team, prev_agent = _NODE_DISPLAY_MAP[last_node]
                event_stream.emit("stage_complete", {
                    "team": prev_team,
                    "agent": prev_agent,
                    "ticker": ticker,
                    "status": "completed",
                })

            # Process signal and emit decision
            final_state = accumulated_state
            decision = graph_obj.process_signal(
                final_state.get("final_trade_decision", "")
            )
            result = _extract_result(final_state, decision)

            event_stream.emit("decision", {
                "ticker": ticker,
                "signal": result.get("signal", "HOLD"),
                "confidence": None,
                "summary": (result.get("raw_decision") or "")[:500],
            })

            logger.info(
                "Streaming analysis complete for %s: signal=%s",
                ticker,
                result["signal"],
            )
            return result

        except AnalysisCancelledError:
            # Re-raise cancellation so the caller (analysis_runner) handles it
            raise

        except Exception as exc:
            logger.exception(
                "[streaming] Exception during streaming analysis for %s", ticker
            )
            event_stream.emit("error", {
                "ticker": ticker,
                "agent": "",
                "message": str(exc),
            })
            return _error_result(ticker, exc)

    def _run(
        self,
        *,
        ticker: str,
        trade_date: str,
        analysts: list[str],
        max_debate_rounds: int,
        max_risk_discuss_rounds: int,
        portfolio_context: Optional[dict[str, Any]] = None,
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

            # If portfolio context is provided, we need to use the graph
            # directly (instead of the convenience propagate() method) so
            # we can inject context into the initial state messages.
            if portfolio_context:
                context_msg = _build_portfolio_context_message(ticker, portfolio_context)
                if context_msg:
                    init_state = graph.propagator.create_initial_state(ticker, trade_date)
                    existing_messages = init_state.get("messages", [])
                    init_state["messages"] = [("system", context_msg)] + list(existing_messages)

                    stream_config = {
                        "recursion_limit": config.get("max_recur_limit", 100),
                    }
                    # Run the graph and collect final state
                    final_state = None
                    for chunk in graph.graph.stream(
                        init_state,
                        stream_mode="values",
                        config=stream_config,
                    ):
                        final_state = chunk

                    if final_state is None:
                        final_state = init_state

                    decision = graph.process_signal(
                        final_state.get("final_trade_decision", "")
                    )
                    result = _extract_result(final_state, decision)
                    logger.info(
                        "Analysis complete for %s: signal=%s",
                        ticker,
                        result["signal"],
                    )
                    return result

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


def _build_portfolio_context_message(
    ticker: str,
    ctx: dict[str, Any],
) -> str | None:
    """Build a portfolio context string to prepend to the graph's initial messages.

    This gives all agents in the TradingAgents pipeline awareness of the
    user's actual position -- cost basis, unrealized P&L, portfolio weight,
    and overall portfolio value -- so that recommendations are personalized
    rather than generic.

    Parameters
    ----------
    ticker
        The ticker being analyzed.
    ctx
        Dict with keys: shares, buy_price, current_price, pnl, pnl_pct,
        weight, total_value.  All values are optional; missing values are
        omitted from the message.

    Returns
    -------
    str or None
        The context message, or None if no meaningful context is available.
    """
    shares = ctx.get("shares")
    buy_price = ctx.get("buy_price")
    if shares is None and buy_price is None:
        return None

    parts = [f"PORTFOLIO CONTEXT for {ticker}:"]

    if shares is not None and buy_price is not None:
        parts.append(
            f"- Position: {shares} shares at cost basis ${buy_price:.2f}/share"
        )
        cost_basis = shares * buy_price
        parts.append(f"- Total cost basis: ${cost_basis:.2f}")

    current_price = ctx.get("current_price")
    if current_price is not None:
        parts.append(f"- Current price: ${current_price:.2f}")

    pnl = ctx.get("pnl")
    pnl_pct = ctx.get("pnl_pct")
    if pnl is not None and pnl_pct is not None:
        parts.append(f"- Unrealized P&L: ${pnl:.2f} ({pnl_pct:.1%})")
    elif pnl is not None:
        parts.append(f"- Unrealized P&L: ${pnl:.2f}")

    weight = ctx.get("weight")
    if weight is not None:
        parts.append(f"- Position weight in portfolio: {weight:.1%}")

    total_value = ctx.get("total_value")
    if total_value is not None:
        parts.append(f"- Portfolio total value: ${total_value:.2f}")

    parts.append("")
    parts.append("Consider this context when making your recommendation.")
    parts.append(
        "A BUY recommendation should consider the existing position size."
    )
    parts.append(
        "A SELL recommendation should note the unrealized gain/loss implications."
    )

    return "\n".join(parts)


def _today() -> str:
    """Return today's date as YYYY-MM-DD string."""
    return date.today().isoformat()
