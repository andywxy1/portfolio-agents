"""Background job orchestration for portfolio analysis.

Uses ThreadPoolExecutor with a single worker to serialize analysis jobs.
Each job:
  1. Determines per-ticker analysis depth from portfolio weight.
  2. Runs tiered analysis via PipelineAdapter (heavy/medium/light)
     in parallel using a configurable thread pool.
  3. Generates portfolio-level synthesis and order recommendations
     via LLM function calling.
  4. Runs sector-gap suggestion engine.
  5. Stores all results in the database.
"""

import json
import logging
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.analysis import AnalysisJob, PortfolioInsight, PositionAnalysis
from app.models.holding import Holding
from app.models.recommendation import Recommendation
from app.models.report import Report
from app.services.event_stream import (
    AnalysisEventStream,
    create_event_stream,
    get_event_stream,
)
from app.services.pipeline_adapter import AnalysisCancelledError, PipelineAdapter
from app.services.portfolio import TICKER_SECTOR_MAP, get_sector
from app.services.recommendation_generator import generate_recommendations
from app.services.suggestion import generate_suggestions
from app.utils import utc_now

logger = logging.getLogger(__name__)


class AnalysisRunner:
    """Manages background analysis job execution."""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._adapter = PipelineAdapter()
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def submit_job(self, job_id: str, config: dict[str, Any] | None = None) -> None:
        """Submit a job to the background executor (non-blocking).

        Creates an AnalysisEventStream for this job so that SSE clients
        can subscribe to live progress updates.
        """
        with self._lock:
            self._cancel_events[job_id] = threading.Event()
        create_event_stream(job_id)
        self._executor.submit(self._run_job, job_id, config or {})

    def cancel_job(self, job_id: str) -> None:
        """Request cancellation of a running job.

        Uses threading.Event.set() which is immediately visible to all
        threads -- no lock acquisition needed for the check side.
        """
        with self._lock:
            event = self._cancel_events.get(job_id)
        if event:
            event.set()

    def _is_cancelled(self, job_id: str) -> bool:
        """Check if a job has been cancelled.

        Uses threading.Event.is_set() which is lock-free and fast.
        """
        with self._lock:
            event = self._cancel_events.get(job_id)
        return event.is_set() if event else False

    def _clear_cancelled(self, job_id: str) -> None:
        """Remove the cancellation event after the job ends."""
        with self._lock:
            self._cancel_events.pop(job_id, None)

    # ------------------------------------------------------------------
    # Job lifecycle
    # ------------------------------------------------------------------

    def _run_job(self, job_id: str, config: dict[str, Any]) -> None:
        """Synchronous job execution in background thread."""
        db = SessionLocal()
        event_stream = get_event_stream(job_id)
        try:
            self._execute(db, job_id, config)
        except Exception:
            logger.exception("Job %s failed with unexpected error", job_id)
            self._fail_job(db, job_id, "Internal error during analysis execution")
            if event_stream:
                event_stream.emit("error", {
                    "ticker": "",
                    "agent": "",
                    "message": "Internal error during analysis execution",
                })
        finally:
            self._clear_cancelled(job_id)
            if event_stream:
                event_stream.mark_complete()
            db.close()

    def _execute(self, db: Session, job_id: str, config: dict[str, Any]) -> None:
        now = utc_now()
        mode = config.get("mode", "portfolio")
        depth_setting = config.get("depth", "auto")

        # Mark running
        job = db.query(AnalysisJob).filter(AnalysisJob.id == job_id).first()
        if not job:
            logger.error("Job %s not found", job_id)
            return
        job.status = "running"
        job.started_at = now
        db.commit()

        user_id = job.user_id
        depth_overrides: dict[str, str] = config.get("depth_overrides", {}) or {}

        # Re-query holdings at execution time (Fix #19)
        holdings = (
            db.query(Holding)
            .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
            .all()
        )
        active_tickers = {h.ticker.upper() for h in holdings}

        # Filter tickers to only those that still have active holdings
        requested_tickers: list[str] = json.loads(job.tickers)
        if mode != "single":
            tickers = [t for t in requested_tickers if t.upper() in active_tickers]
        else:
            # Single mode: always analyse the requested ticker even if not held
            tickers = requested_tickers

        if not tickers:
            job.status = "completed"
            job.completed_at = utc_now()
            job.error_message = "No active holdings found for analysis"
            db.commit()
            return

        # Update tickers and total count (may have changed from re-query)
        job.tickers = json.dumps(tickers)
        job.total_tickers = len(tickers)
        db.commit()

        # Compute weights using current prices where available
        weight_map, current_prices = _compute_weight_map_with_prices(db, holdings)

        # Build per-ticker portfolio context for position-aware analysis
        portfolio_context_map = _build_portfolio_context_map(holdings, current_prices, weight_map)

        # Build per-ticker depth map based on depth_setting
        ticker_depth_map: dict[str, str] = {}
        for ticker in tickers:
            if depth_setting == "auto":
                # Original behaviour: tiered by weight, with mode overrides
                if mode in ("single", "all_individual"):
                    ticker_depth_map[ticker] = "full"
                else:
                    ticker_depth_map[ticker] = depth_overrides.get(
                        ticker
                    ) or _determine_depth(weight_map.get(ticker, 0.0))
            elif depth_setting == "light":
                ticker_depth_map[ticker] = "quick"
            elif depth_setting == "medium":
                ticker_depth_map[ticker] = "standard"
            elif depth_setting == "deep":
                ticker_depth_map[ticker] = "full"
            else:
                ticker_depth_map[ticker] = _determine_depth(
                    weight_map.get(ticker, 0.0)
                )

        # Thread-safe counter for completed tickers
        completed_lock = threading.Lock()
        completed_count = 0
        position_summaries: list[dict[str, Any]] = []
        cancelled_detected = False
        event_stream = get_event_stream(job_id)

        # Emit initial job status
        if event_stream:
            event_stream.emit("job_status", {
                "status": "running",
                "tickers_completed": 0,
                "tickers_total": len(tickers),
            })

        # Map depth labels for display: internal -> user-facing
        _depth_display = {
            "full": "deep",
            "heavy": "deep",
            "standard": "medium",
            "medium": "medium",
            "quick": "light",
            "light": "light",
        }

        def _analyze_single_ticker(
            ticker: str,
            depth: str,
            position: int,
        ) -> dict[str, Any]:
            """Analyze a single ticker in its own thread with its own DB session."""
            nonlocal completed_count, cancelled_detected

            # Each thread gets its own DB session
            thread_db = SessionLocal()
            ticker_start = time.monotonic()
            display_depth = _depth_display.get(depth, depth)

            try:
                # Emit ticker_start event
                if event_stream:
                    event_stream.emit("ticker_start", {
                        "ticker": ticker,
                        "depth": display_depth,
                        "position": position,
                        "total": len(tickers),
                    })

                # Create position analysis row
                pa_id = str(uuid.uuid4())
                pa = PositionAnalysis(
                    id=pa_id,
                    job_id=job_id,
                    user_id=user_id,
                    ticker=ticker,
                    analysis_depth=depth,
                    status="running",
                    created_at=utc_now(),
                )
                thread_db.add(pa)
                thread_db.commit()

                # Run analysis via the tiered adapter (blocking).
                # Pass portfolio context so agents know the user's position.
                ticker_portfolio_ctx = portfolio_context_map.get(ticker.upper())
                result = self._adapter.analyze_ticker_streaming(
                    ticker,
                    depth,
                    event_stream=event_stream,
                    cancel_check=lambda: self._is_cancelled(job_id),
                    portfolio_context=ticker_portfolio_ctx,
                )

                elapsed = round(time.monotonic() - ticker_start, 1)

                # Check for pipeline-level errors
                if result.get("signal") == "ERROR":
                    pa.status = "failed"
                    pa.error_message = result.get("error", "Unknown pipeline error")
                    pa.completed_at = utc_now()
                    thread_db.commit()

                    if event_stream:
                        event_stream.emit("ticker_complete", {
                            "ticker": ticker,
                            "depth": display_depth,
                            "signal": "ERROR",
                            "elapsed_seconds": elapsed,
                        })

                    return {
                        "ticker": ticker,
                        "signal": "ERROR",
                        "depth": depth,
                        "raw_decision": result.get("raw_decision", ""),
                    }

                # Store results
                price = current_prices.get(ticker.upper())
                pa.status = "completed"
                pa.signal = result.get("signal")
                pa.raw_decision = result.get("raw_decision")
                pa.market_report = _to_json(result.get("market_report"))
                pa.sentiment_report = _to_json(result.get("sentiment_report"))
                pa.news_report = _to_json(result.get("news_report"))
                pa.fundamentals_report = _to_json(result.get("fundamentals_report"))
                pa.investment_debate = _to_json(result.get("investment_debate"))
                pa.risk_debate = _to_json(result.get("risk_debate"))
                pa.investment_plan = _to_json(result.get("investment_plan"))
                pa.current_price = price
                pa.price_change_pct = None
                pa.completed_at = utc_now()
                thread_db.commit()

                # Store reports
                self._store_reports(thread_db, job_id, pa_id, user_id, ticker, result)

                signal = result.get("signal", "HOLD")

                if event_stream:
                    event_stream.emit("ticker_complete", {
                        "ticker": ticker,
                        "depth": display_depth,
                        "signal": signal,
                        "elapsed_seconds": elapsed,
                    })

                return {
                    "ticker": ticker,
                    "signal": signal,
                    "depth": depth,
                    "raw_decision": result.get("raw_decision", ""),
                }

            except AnalysisCancelledError:
                logger.info(
                    "Analysis cancelled mid-ticker for %s in job %s",
                    ticker,
                    job_id,
                )
                pa_row = (
                    thread_db.query(PositionAnalysis)
                    .filter(
                        PositionAnalysis.job_id == job_id,
                        PositionAnalysis.ticker == ticker,
                    )
                    .first()
                )
                if pa_row and pa_row.status == "running":
                    pa_row.status = "failed"
                    pa_row.error_message = "Cancelled by user"
                    pa_row.completed_at = utc_now()
                thread_db.commit()
                cancelled_detected = True
                raise

            except Exception:
                logger.exception(
                    "Analysis failed for ticker %s in job %s", ticker, job_id
                )
                pa_row = (
                    thread_db.query(PositionAnalysis)
                    .filter(
                        PositionAnalysis.job_id == job_id,
                        PositionAnalysis.ticker == ticker,
                    )
                    .first()
                )
                if pa_row:
                    pa_row.status = "failed"
                    pa_row.error_message = f"Analysis failed for {ticker}"
                    pa_row.completed_at = utc_now()
                thread_db.commit()

                elapsed = round(time.monotonic() - ticker_start, 1)
                if event_stream:
                    event_stream.emit("ticker_complete", {
                        "ticker": ticker,
                        "depth": display_depth,
                        "signal": "ERROR",
                        "elapsed_seconds": elapsed,
                    })

                return {
                    "ticker": ticker,
                    "signal": "ERROR",
                    "depth": depth,
                    "raw_decision": f"Analysis failed for {ticker}",
                }

            finally:
                # Always increment the counter and update job progress
                with completed_lock:
                    completed_count += 1
                    current_count = completed_count

                # Update job progress in a fresh query (main db session for job updates)
                try:
                    thread_db.execute(
                        AnalysisJob.__table__.update()
                        .where(AnalysisJob.id == job_id)
                        .values(completed_tickers=current_count)
                    )
                    thread_db.commit()
                except Exception:
                    logger.warning("Failed to update completed_tickers for job %s", job_id)

                if event_stream:
                    event_stream.emit("job_status", {
                        "status": "running",
                        "tickers_completed": current_count,
                        "tickers_total": len(tickers),
                    })

                thread_db.close()

        # ----- Run ticker analyses in parallel -----
        concurrency = min(settings.analysis_concurrency, len(tickers))
        logger.info(
            "Job %s: analyzing %d tickers with concurrency=%d depth_setting=%s",
            job_id,
            len(tickers),
            concurrency,
            depth_setting,
        )

        with ThreadPoolExecutor(max_workers=concurrency) as ticker_pool:
            futures = {}
            for idx, ticker in enumerate(tickers, 1):
                depth = ticker_depth_map[ticker]
                future = ticker_pool.submit(
                    _analyze_single_ticker, ticker, depth, idx
                )
                futures[future] = ticker

            for future in as_completed(futures):
                # Check cancellation before blocking on result -- break
                # immediately so we don't wait for remaining futures
                if self._is_cancelled(job_id):
                    cancelled_detected = True
                    # Cancel any futures that haven't started yet
                    for f in futures:
                        f.cancel()
                    break

                ticker = futures[future]
                try:
                    summary = future.result()
                    position_summaries.append(summary)
                except AnalysisCancelledError:
                    # Cancellation: cancel remaining futures and break
                    cancelled_detected = True
                    for f in futures:
                        f.cancel()
                    break
                except Exception:
                    logger.exception(
                        "Unexpected error collecting result for %s in job %s",
                        ticker,
                        job_id,
                    )

        # If cancellation was detected, ensure job is marked cancelled and exit.
        # The cancel endpoint may have already updated the DB and emitted the
        # SSE event, so we check before writing to avoid redundant updates.
        if cancelled_detected or self._is_cancelled(job_id):
            job = db.query(AnalysisJob).filter(AnalysisJob.id == job_id).first()
            if job and job.status not in ("cancelled", "failed"):
                job.status = "cancelled"
                job.completed_at = utc_now()
                job.error_message = "Cancelled by user"
                db.commit()
            if event_stream and not event_stream.is_complete:
                event_stream.emit("job_status", {
                    "status": "cancelled",
                    "tickers_completed": completed_count,
                    "tickers_total": len(tickers),
                })
            logger.info("Job %s cancelled by user", job_id)
            return

        # Refresh the job object after parallel work
        db.expire_all()
        job = db.query(AnalysisJob).filter(AnalysisJob.id == job_id).first()
        if not job:
            logger.error("Job %s disappeared after parallel phase", job_id)
            return

        # ---------------------------------------------------------------
        # Portfolio-level synthesis + recommendations
        # (Skip for single mode -- no portfolio-level analysis needed)
        # ---------------------------------------------------------------
        if mode != "single" and not self._is_cancelled(job_id):
            try:
                allocation, concentration, sector_breakdown = (
                    self._build_portfolio_data(holdings, current_prices)
                )

                self._generate_portfolio_insight(
                    db,
                    job_id,
                    user_id,
                    tickers,
                    holdings,
                    position_summaries,
                    allocation,
                    concentration,
                    sector_breakdown,
                )

                # Generate structured order recommendations via LLM
                self._generate_order_recommendations(
                    db,
                    job_id,
                    user_id,
                    position_summaries,
                    allocation,
                    concentration,
                    sector_breakdown,
                    current_prices,
                )
            except Exception:
                logger.exception("Portfolio synthesis failed for job %s", job_id)

            # Sector-gap suggestions
            try:
                generate_suggestions(db, job_id, user_id, holdings, current_prices=current_prices)
            except Exception:
                logger.exception("Suggestion generation failed for job %s", job_id)

        # Mark complete (unless cancelled during synthesis)
        if not self._is_cancelled(job_id):
            job.status = "completed"
            job.completed_at = utc_now()
            db.commit()
            logger.info("Job %s completed successfully", job_id)
            if event_stream:
                event_stream.emit("job_status", {
                    "status": "completed",
                    "tickers_completed": completed_count,
                    "tickers_total": len(tickers),
                })
        else:
            # Cancel endpoint may have already marked the job; only update if needed
            if job.status not in ("cancelled", "failed"):
                job.status = "cancelled"
                job.completed_at = utc_now()
                job.error_message = "Cancelled by user"
                db.commit()
            logger.info("Job %s cancelled by user", job_id)
            if event_stream and not event_stream.is_complete:
                event_stream.emit("job_status", {
                    "status": "cancelled",
                    "tickers_completed": completed_count,
                    "tickers_total": len(tickers),
                })

    # ------------------------------------------------------------------
    # Report storage
    # ------------------------------------------------------------------

    def _store_reports(
        self,
        db: Session,
        job_id: str,
        pa_id: str,
        user_id: str,
        ticker: str,
        result: dict[str, Any],
    ) -> None:
        """Store individual agent reports from analysis results."""
        report_mappings = [
            ("market_report", "market_analysis", "Market Analysis"),
            ("sentiment_report", "sentiment_analysis", "Sentiment Analysis"),
            ("news_report", "news_analysis", "News Analysis"),
            ("fundamentals_report", "fundamentals_analysis", "Fundamentals Analysis"),
            ("investment_debate", "investment_debate", "Investment Debate"),
            ("risk_debate", "risk_debate", "Risk Debate"),
            ("investment_plan", "investment_plan", "Investment Plan"),
        ]

        for key, report_type, title in report_mappings:
            data = result.get(key)
            if data is None:
                continue

            # For string reports (from TradingAgents), wrap in a dict
            if isinstance(data, str):
                content_json = json.dumps({"text": data})
                summary = data[:200] if data else f"{title} for {ticker}"
            elif isinstance(data, dict):
                content_json = json.dumps(data)
                summary = data.get("summary", f"{title} for {ticker}")
            else:
                content_json = json.dumps(data)
                summary = f"{title} for {ticker}"

            report = Report(
                id=str(uuid.uuid4()),
                job_id=job_id,
                position_analysis_id=pa_id,
                user_id=user_id,
                ticker=ticker,
                report_type=report_type,
                title=f"{title} - {ticker}",
                content=content_json,
                summary=summary[:500] if isinstance(summary, str) else str(summary)[:500],
                created_at=utc_now(),
            )
            db.add(report)

        # Final decision report
        if result.get("signal"):
            report = Report(
                id=str(uuid.uuid4()),
                job_id=job_id,
                position_analysis_id=pa_id,
                user_id=user_id,
                ticker=ticker,
                report_type="final_decision",
                title=f"Final Decision - {ticker}",
                content=json.dumps({
                    "signal": result["signal"],
                    "raw_decision": result.get("raw_decision", ""),
                }),
                summary=f"Signal: {result['signal']} for {ticker}",
                created_at=utc_now(),
            )
            db.add(report)

        db.commit()

    # ------------------------------------------------------------------
    # Portfolio data helpers
    # ------------------------------------------------------------------

    def _build_portfolio_data(
        self,
        holdings: list[Holding],
        current_prices: dict[str, float],
    ) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
        """Compute allocation, concentration, and sector breakdown.

        Uses current prices where available, falling back to buy_price.
        Returns (allocation, concentration, sector_breakdown).
        """
        # Compute position values
        entries: list[dict[str, Any]] = []
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
                "weight": 0.0,  # filled below
                "pnl": round(pnl, 2) if pnl is not None else None,
                "pnl_pct": round(pnl_pct, 6) if pnl_pct is not None else None,
            })

        # Weights
        if total_value > 0:
            for e in entries:
                e["weight"] = round(e["market_value"] / total_value, 6)

        # Concentration
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
        sector_map: dict[str, dict[str, Any]] = {}
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

    # ------------------------------------------------------------------
    # Portfolio insight (stored in DB)
    # ------------------------------------------------------------------

    def _generate_portfolio_insight(
        self,
        db: Session,
        job_id: str,
        user_id: str,
        tickers: list[str],
        holdings: list[Holding],
        position_summaries: list[dict[str, Any]],
        allocation: list[dict[str, Any]],
        concentration: dict[str, Any],
        sector_breakdown: list[dict[str, Any]],
    ) -> None:
        """Generate and store portfolio-level insight."""
        total_cost = sum(h.shares * h.buy_price for h in holdings) if holdings else 0
        total_value = sum(a["market_value"] for a in allocation) if allocation else None

        total_pnl = (total_value - total_cost) if total_value is not None else None
        total_pnl_pct = (
            (total_pnl / total_cost) if total_pnl is not None and total_cost > 0 else None
        )

        # Signal summary
        signals = [ps["signal"] for ps in position_summaries if ps.get("signal")]
        buy_count = sum(1 for s in signals if s in ("BUY", "OVERWEIGHT"))
        sell_count = sum(1 for s in signals if s in ("SELL", "UNDERWEIGHT"))
        hold_count = sum(1 for s in signals if s == "HOLD")
        error_count = sum(1 for s in signals if s == "ERROR")

        hhi = concentration.get("hhi", 0)
        num_sectors = len(sector_breakdown)

        # Build per-position P&L summary lines
        pnl_lines: list[str] = []
        for a in allocation:
            t = a.get("ticker", "?")
            bp = a.get("buy_price")
            cp = a.get("current_price")
            p = a.get("pnl")
            pp = a.get("pnl_pct")
            if bp is not None and p is not None and pp is not None:
                pnl_lines.append(
                    f"  {t}: bought ${bp:.2f}, now ${cp:.2f}, "
                    f"P&L ${p:+,.2f} ({pp:+.1%})"
                )

        pnl_detail = ""
        if pnl_lines:
            pnl_detail = "\n\nPer-position P&L:\n" + "\n".join(pnl_lines)

        total_pnl_str = ""
        if total_pnl is not None and total_pnl_pct is not None:
            total_pnl_str = (
                f" Total portfolio P&L: ${total_pnl:+,.2f} ({total_pnl_pct:+.1%})."
            )

        summary = (
            f"Portfolio analysis complete for {len(tickers)} positions. "
            f"Signals: {buy_count} buy/overweight, {hold_count} hold, "
            f"{sell_count} sell/underweight"
            + (f", {error_count} failed" if error_count else "")
            + f".{total_pnl_str}"
            + f" Portfolio HHI concentration index is {hhi:.0f} "
            f"({'concentrated' if hhi > 2500 else 'moderately diversified' if hhi > 1500 else 'well diversified'})."
            + pnl_detail
        )

        sorted_w = sorted(
            (a["weight"] for a in allocation if a["weight"] > 0), reverse=True
        )

        strengths = [
            s
            for s in [
                f"Diversified across {num_sectors} sectors"
                if num_sectors > 3
                else None,
                f"{buy_count} positions show positive signals"
                if buy_count > 0
                else None,
                "Reasonable position sizing across holdings"
                if (sorted_w[0] < 0.25 if sorted_w else False)
                else None,
            ]
            if s
        ]

        weaknesses = [
            w
            for w in [
                f"High concentration: top position is {sorted_w[0]:.1%} of portfolio"
                if (sorted_w and sorted_w[0] > 0.2)
                else None,
                f"{sell_count} positions have sell/underweight signals"
                if sell_count > 0
                else None,
                f"Limited sector coverage ({num_sectors} of 11 GICS sectors)"
                if num_sectors < 5
                else None,
                f"{error_count} positions could not be analysed"
                if error_count > 0
                else None,
            ]
            if w
        ]

        action_items = [
            a
            for a in [
                f"Review {sell_count} underperforming positions for potential exits"
                if sell_count > 0
                else None,
                "Consider adding exposure to underrepresented sectors"
                if num_sectors < 6
                else None,
                f"Evaluate rebalancing to reduce concentration (HHI: {hhi:.0f})"
                if hhi > 2000
                else None,
            ]
            if a
        ]

        insight = PortfolioInsight(
            id=str(uuid.uuid4()),
            job_id=job_id,
            user_id=user_id,
            total_value=round(total_value, 2) if total_value is not None else None,
            total_cost_basis=round(total_cost, 2),
            total_pnl=round(total_pnl, 2) if total_pnl is not None else None,
            total_pnl_pct=round(total_pnl_pct, 6) if total_pnl_pct is not None else None,
            allocation_breakdown=json.dumps(allocation),
            sector_breakdown=json.dumps(sector_breakdown),
            concentration_metrics=json.dumps(concentration),
            risk_assessment=json.dumps({
                "diversification_score": round(min(num_sectors / 11 * 10, 10), 1),
                "concentration_risk": (
                    "high" if hhi > 2500 else "moderate" if hhi > 1500 else "low"
                ),
            }),
            summary=summary,
            strengths=json.dumps(strengths) if strengths else None,
            weaknesses=json.dumps(weaknesses) if weaknesses else None,
            action_items=json.dumps(action_items) if action_items else None,
            created_at=utc_now(),
        )
        db.add(insight)
        db.commit()

    # ------------------------------------------------------------------
    # Order recommendations via LLM function calling
    # ------------------------------------------------------------------

    def _generate_order_recommendations(
        self,
        db: Session,
        job_id: str,
        user_id: str,
        position_summaries: list[dict[str, Any]],
        allocation: list[dict[str, Any]],
        concentration: dict[str, Any],
        sector_breakdown: list[dict[str, Any]],
        current_prices: dict[str, float],
    ) -> None:
        """Call recommendation_generator and store results."""
        recs = generate_recommendations(
            position_summaries=position_summaries,
            allocation=allocation,
            concentration=concentration,
            sector_breakdown=sector_breakdown,
            current_prices=current_prices,
        )

        for rec in recs:
            side = rec.get("side", "buy")
            tags = [rec.get("signal", side), side]
            if rec.get("priority_label"):
                tags.append(rec["priority_label"])

            # Fix #12: handle None/0 quantity gracefully -- default to 1
            # share when the LLM doesn't provide a quantity.
            # (DB schema requires quantity > 0 on existing databases.)
            quantity = rec.get("quantity")
            try:
                quantity = float(quantity) if quantity is not None else 0
            except (TypeError, ValueError):
                quantity = 0
            if quantity <= 0:
                quantity = 1.0

            db_rec = Recommendation(
                id=str(uuid.uuid4()),
                job_id=job_id,
                user_id=user_id,
                ticker=rec.get("ticker", ""),
                order_type=rec.get("order_type", "market"),
                side=side,
                quantity=quantity,
                limit_price=rec.get("limit_price"),
                stop_price=rec.get("stop_price"),
                time_in_force=rec.get("time_in_force", "day"),
                expiration=rec.get("expiration"),
                condition_text=rec.get("conditions"),
                confidence=rec.get("confidence"),
                rationale=rec.get("rationale", ""),
                priority=rec.get("priority", 1),
                tags=json.dumps(tags),
                status="pending",
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            db.add(db_rec)

        db.commit()
        logger.info(
            "Stored %d order recommendations for job %s", len(recs), job_id
        )

    # ------------------------------------------------------------------
    # Error helpers
    # ------------------------------------------------------------------

    def _fail_job(self, db: Session, job_id: str, message: str) -> None:
        """Mark a job as failed."""
        job = db.query(AnalysisJob).filter(AnalysisJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.error_message = message
            job.completed_at = utc_now()
            db.commit()


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_runner: AnalysisRunner | None = None


def get_runner() -> AnalysisRunner:
    global _runner
    if _runner is None:
        _runner = AnalysisRunner()
    return _runner


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_json(obj: Any) -> str | None:
    if obj is None:
        return None
    if isinstance(obj, str):
        # Already a string (e.g. raw report text from TradingAgents).
        # Wrap in JSON so the column always stores valid JSON.
        return json.dumps({"text": obj})
    return json.dumps(obj)


def _compute_weight_map_with_prices(
    db: Session,
    holdings: list[Holding],
) -> tuple[dict[str, float], dict[str, float]]:
    """Compute portfolio weights using current prices where available.

    Falls back to buy_price when no current price is cached.

    Returns
    -------
    (weight_map, current_prices)
        weight_map : ticker -> portfolio weight (0-1)
        current_prices : ticker -> current price (only tickers where a
        price was found)
    """
    current_prices: dict[str, float] = {}

    # Try to fetch prices; this is best-effort (no hard failure)
    try:
        from app.services.pricing import get_prices_batch

        price_data = get_prices_batch(db, [h.ticker for h in holdings])
        for ticker, pd in price_data.items():
            if pd is not None and pd.price is not None:
                current_prices[ticker.upper()] = pd.price
    except Exception:
        logger.warning("Could not fetch current prices; using buy_price for weights")

    # Compute position values
    total = 0.0
    position_values: dict[str, float] = {}
    for h in holdings:
        price = current_prices.get(h.ticker.upper(), h.buy_price)
        value = h.shares * price
        position_values[h.ticker] = value
        total += value

    if total == 0:
        return {}, current_prices

    weight_map = {ticker: val / total for ticker, val in position_values.items()}
    return weight_map, current_prices


def _build_portfolio_context_map(
    holdings: list[Holding],
    current_prices: dict[str, float],
    weight_map: dict[str, float],
) -> dict[str, dict[str, Any]]:
    """Build per-ticker portfolio context dicts for position-aware analysis.

    Returns a dict mapping uppercase ticker -> context dict with keys:
    shares, buy_price, current_price, pnl, pnl_pct, weight, total_value.
    """
    # Compute total portfolio value
    total_value = 0.0
    for h in holdings:
        price = current_prices.get(h.ticker.upper(), h.buy_price)
        total_value += h.shares * price

    context_map: dict[str, dict[str, Any]] = {}
    for h in holdings:
        ticker_upper = h.ticker.upper()
        price = current_prices.get(ticker_upper)
        cost_basis = h.shares * h.buy_price

        if price is not None:
            market_value = h.shares * price
            pnl = market_value - cost_basis
            pnl_pct = pnl / cost_basis if cost_basis > 0 else None
        else:
            pnl = None
            pnl_pct = None

        context_map[ticker_upper] = {
            "shares": h.shares,
            "buy_price": h.buy_price,
            "current_price": price,
            "pnl": round(pnl, 2) if pnl is not None else None,
            "pnl_pct": pnl_pct,
            "weight": weight_map.get(h.ticker, 0.0),
            "total_value": round(total_value, 2),
        }

    return context_map


def _determine_depth(weight: float) -> str:
    """Determine analysis depth based on portfolio weight.

    Uses configurable thresholds from settings:
      - weight >= heavy_threshold  -> "full"   (heavy tier)
      - weight >= medium_threshold -> "standard" (medium tier)
      - weight < medium_threshold  -> "quick"  (light tier)

    Thresholds are normalised to fractions (0-1) if they arrive as
    percentage integers (e.g. 10 instead of 0.10) from the frontend.
    """
    heavy = settings.weight_heavy_threshold
    medium = settings.weight_medium_threshold

    # Normalise: if thresholds look like percentages (> 1), convert to fractions
    if heavy > 1:
        heavy = heavy / 100.0
    if medium > 1:
        medium = medium / 100.0

    if weight >= heavy:
        return "full"
    elif weight >= medium:
        return "standard"
    else:
        return "quick"
