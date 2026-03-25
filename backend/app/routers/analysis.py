"""Analysis job endpoints.

POST   /api/analysis/start          -> start a new analysis job
GET    /api/analysis/jobs            -> list all analysis jobs (paginated)
GET    /api/analysis/jobs/:id        -> get job status and results
POST   /api/analysis/cancel/:job_id  -> cancel a running analysis job
GET    /api/analysis/latest          -> get the latest completed analysis
GET    /api/analysis/jobs/:id/stream -> SSE stream for live progress
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.analysis import AnalysisJob, PortfolioInsight, PositionAnalysis
from app.models.holding import Holding
from app.models.recommendation import Recommendation
from app.models.suggestion import StockSuggestion
from app.schemas.analysis import (
    AnalysisJobConfig,
    AnalysisJobListItem,
    AnalysisJobResponse,
    PositionAnalysisResponse,
    PositionAnalysisSummary,
    StartAnalysisRequest,
    StartAnalysisResponse,
)
from app.schemas.portfolio import (
    AllocationEntry,
    ConcentrationMetrics,
    PortfolioInsightResponse,
    SectorEntry,
)
from app.schemas.recommendation import RecommendationResponse
from app.schemas.suggestion import StockSuggestionResponse
from app.services.analysis_runner import get_runner
from app.services.event_stream import get_event_stream
from app.utils import utc_now

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.post("/start", response_model=StartAnalysisResponse, status_code=201)
def start_analysis(
    body: StartAnalysisRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> StartAnalysisResponse:
    """Start a new background analysis job.

    Modes:
    - single: analyse one ticker at full depth
    - portfolio: analyse all holdings with tiered depth (default)
    - all_individual: analyse every holding at full depth
    """
    # Rate limit: block if there's already a pending/running job
    active_job = (
        db.query(AnalysisJob)
        .filter(
            AnalysisJob.user_id == user_id,
            AnalysisJob.status.in_(["pending", "running"]),
        )
        .first()
    )
    if active_job:
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "ANALYSIS_IN_PROGRESS",
                    "message": "An analysis is already in progress.",
                    "active_job_id": active_job.id,
                }
            },
        )

    mode = body.mode or "portfolio"
    depth = body.depth or "auto"

    # Determine tickers based on mode
    if mode == "single":
        if not body.ticker:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": {
                        "code": "MISSING_TICKER",
                        "message": "The 'ticker' field is required for single mode.",
                    }
                },
            )
        tickers = [body.ticker.upper()]
    else:
        tickers = body.tickers or []
        if not tickers:
            # Use all active holdings
            holdings = (
                db.query(Holding)
                .filter(Holding.user_id == user_id, Holding.deleted_at.is_(None))
                .all()
            )
            tickers = [h.ticker for h in holdings]

    if not tickers:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "NO_TICKERS",
                    "message": "No tickers specified and no holdings found. Add holdings first or specify tickers.",
                }
            },
        )

    tickers = [t.upper() for t in tickers]

    config_dict = body.config.model_dump() if body.config else None

    # For single mode, force full depth
    if mode == "single":
        if config_dict is None:
            config_dict = {}
        config_dict["depth_overrides"] = {tickers[0]: "full"}

    # For all_individual mode, force full depth on every ticker
    if mode == "all_individual":
        if config_dict is None:
            config_dict = {}
        config_dict["depth_overrides"] = {t: "full" for t in tickers}

    job = AnalysisJob(
        id=str(uuid.uuid4()),
        user_id=user_id,
        status="pending",
        mode=mode,
        depth=depth,
        tickers=json.dumps(tickers),
        total_tickers=len(tickers),
        completed_tickers=0,
        config=json.dumps(config_dict) if config_dict else None,
        created_at=utc_now(),
    )
    db.add(job)
    db.commit()

    # Submit to background runner
    runner_config = config_dict or {}
    runner_config["mode"] = mode
    runner_config["depth"] = depth
    get_runner().submit_job(job.id, runner_config)

    return StartAnalysisResponse(
        job_id=job.id,
        status=job.status,
        tickers=tickers,
        total_tickers=len(tickers),
        mode=mode,
        depth=depth,
    )


@router.get("/jobs", response_model=None)
def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """List all analysis jobs (paginated, newest first).

    Used by the History page.
    """
    query = db.query(AnalysisJob).filter(AnalysisJob.user_id == user_id)
    total = query.count()

    jobs = (
        query
        .order_by(AnalysisJob.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items: list[dict] = []
    for job in jobs:
        # Count failed position analyses for this job
        failed_count = (
            db.query(func.count(PositionAnalysis.id))
            .filter(
                PositionAnalysis.job_id == job.id,
                PositionAnalysis.status == "failed",
            )
            .scalar()
        ) or 0

        items.append(
            AnalysisJobListItem(
                id=job.id,
                status=job.status,
                mode=job.mode,
                depth=job.depth or "auto",
                created_at=job.created_at,
                completed_at=job.completed_at,
                tickers_total=job.total_tickers,
                tickers_completed=job.completed_tickers,
                tickers_failed=failed_count,
                error_message=job.error_message,
            ).model_dump()
        )

    return {
        "data": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
    }


@router.post("/cancel/{job_id}")
def cancel_job(
    job_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """Cancel a pending or running analysis job."""
    job = (
        db.query(AnalysisJob)
        .filter(AnalysisJob.id == job_id, AnalysisJob.user_id == user_id)
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "JOB_NOT_FOUND",
                    "message": f"Analysis job '{job_id}' not found",
                }
            },
        )

    if job.status not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "INVALID_STATUS",
                    "message": f"Cannot cancel job with status '{job.status}'",
                }
            },
        )

    # 1. Mark job as cancelled in DB immediately so frontend sees it
    job.status = "cancelled"
    job.completed_at = utc_now()
    job.error_message = "Cancelled by user"
    db.commit()

    # 2. Signal the runner (sets threading.Event visible to all worker threads)
    get_runner().cancel_job(job_id)

    # 3. Emit cancellation SSE event immediately so frontend updates without
    #    waiting for the background threads to notice the cancellation
    stream = get_event_stream(job_id)
    if stream:
        stream.emit("job_status", {
            "status": "cancelled",
            "tickers_completed": job.completed_tickers,
            "tickers_total": job.total_tickers,
        })
        stream.mark_complete()

    return {"status": "cancelled", "job_id": job_id}


@router.get("/jobs/{job_id}/stream")
async def stream_analysis(job_id: str) -> StreamingResponse:
    """SSE endpoint for live analysis progress.

    This endpoint does NOT require API-key auth because SSE connections
    (EventSource) cannot easily pass custom headers.  The job_id itself
    acts as an unguessable token (UUID4).

    The client receives events in standard SSE format::

        id: 0
        event: stage_start
        data: {"team":"Analyst Team","agent":"Market Analyst","ticker":"AAPL"}

    The stream ends with a ``done`` event once the job completes.
    Clients can reconnect and pass ``Last-Event-ID`` to resume from
    where they left off (though this simple implementation uses the
    query-string ``last_id`` parameter instead).
    """
    stream = get_event_stream(job_id)
    if not stream:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "NO_STREAM",
                    "message": f"No active event stream for job '{job_id}'",
                }
            },
        )

    async def event_generator():
        last_id = -1
        while True:
            for event in stream.subscribe(last_id):
                last_id = event["id"]
                yield f"id: {event['id']}\n"
                yield f"event: {event['type']}\n"
                yield f"data: {json.dumps(event['data'])}\n\n"

            if stream.is_complete:
                # Drain any remaining events that arrived between the
                # last subscribe() call and mark_complete().
                for event in stream.subscribe(last_id):
                    last_id = event["id"]
                    yield f"id: {event['id']}\n"
                    yield f"event: {event['type']}\n"
                    yield f"data: {json.dumps(event['data'])}\n\n"
                yield f"event: done\ndata: {{}}\n\n"
                break

            # Yield a keep-alive comment every cycle to detect broken
            # connections and avoid proxy timeouts.
            yield ": keepalive\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.get("/jobs/{job_id}", response_model=AnalysisJobResponse)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> AnalysisJobResponse:
    """Get analysis job status and results."""
    job = (
        db.query(AnalysisJob)
        .filter(AnalysisJob.id == job_id, AnalysisJob.user_id == user_id)
        .first()
    )
    if not job:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "JOB_NOT_FOUND",
                    "message": f"Analysis job '{job_id}' not found",
                }
            },
        )

    return _job_to_response(db, job)


@router.get("/latest")
def get_latest_analysis(
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> dict:
    """Get the latest completed analysis with all associated data."""
    job = (
        db.query(AnalysisJob)
        .filter(AnalysisJob.user_id == user_id, AnalysisJob.status == "completed")
        .order_by(AnalysisJob.completed_at.desc())
        .first()
    )

    if not job:
        return {
            "job": None,
            "position_analyses": [],
            "portfolio_insight": None,
            "recommendations": [],
            "suggestions": [],
        }

    # Position analyses
    pas = (
        db.query(PositionAnalysis)
        .filter(PositionAnalysis.job_id == job.id)
        .all()
    )
    pa_responses = [_position_analysis_to_response(pa) for pa in pas]

    # Portfolio insight
    insight = (
        db.query(PortfolioInsight)
        .filter(PortfolioInsight.job_id == job.id)
        .first()
    )
    insight_response = _insight_to_response(insight) if insight else None

    # Recommendations
    recs = (
        db.query(Recommendation)
        .filter(Recommendation.job_id == job.id)
        .order_by(Recommendation.priority.desc())
        .all()
    )
    rec_responses = [_rec_to_response(r) for r in recs]

    # Suggestions
    sgs = (
        db.query(StockSuggestion)
        .filter(StockSuggestion.job_id == job.id)
        .all()
    )
    sg_responses = [_suggestion_to_response(s) for s in sgs]

    return {
        "job": _job_to_response(db, job).model_dump(),
        "position_analyses": [p.model_dump() for p in pa_responses],
        "portfolio_insight": insight_response.model_dump() if insight_response else None,
        "recommendations": [r.model_dump() for r in rec_responses],
        "suggestions": [s.model_dump() for s in sg_responses],
    }


# --- Helpers ---


def _job_to_response(db: Session, job: AnalysisJob) -> AnalysisJobResponse:
    tickers = json.loads(job.tickers) if job.tickers else []
    config = None
    if job.config:
        try:
            config = AnalysisJobConfig(**json.loads(job.config))
        except Exception:
            config = None

    position_analyses = None
    if job.status == "completed":
        pas = db.query(PositionAnalysis).filter(PositionAnalysis.job_id == job.id).all()
        position_analyses = [
            PositionAnalysisSummary(
                id=pa.id,
                ticker=pa.ticker,
                status=pa.status,
                signal=pa.signal,
                analysis_depth=pa.analysis_depth,
                current_price=pa.current_price,
            )
            for pa in pas
        ]

    return AnalysisJobResponse(
        id=job.id,
        user_id=job.user_id,
        status=job.status,
        mode=job.mode,
        depth=job.depth or "auto",
        tickers=tickers,
        total_tickers=job.total_tickers,
        completed_tickers=job.completed_tickers,
        config=config,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        position_analyses=position_analyses,
    )


def _position_analysis_to_response(pa: PositionAnalysis) -> PositionAnalysisResponse:
    def _parse_json(val: str | None) -> dict | None:
        if val is None:
            return None
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return None

    investment_debate = _parse_json(pa.investment_debate)
    risk_debate = _parse_json(pa.risk_debate)

    return PositionAnalysisResponse(
        id=pa.id,
        job_id=pa.job_id,
        user_id=pa.user_id,
        ticker=pa.ticker,
        analysis_depth=pa.analysis_depth,
        status=pa.status,
        signal=pa.signal,
        raw_decision=pa.raw_decision,
        market_report=_parse_json(pa.market_report),
        sentiment_report=_parse_json(pa.sentiment_report),
        news_report=_parse_json(pa.news_report),
        fundamentals_report=_parse_json(pa.fundamentals_report),
        investment_debate=investment_debate,
        risk_debate=risk_debate,
        investment_plan=_parse_json(pa.investment_plan),
        current_price=pa.current_price,
        price_change_pct=pa.price_change_pct,
        error_message=pa.error_message,
        created_at=pa.created_at,
        completed_at=pa.completed_at,
    )


def _insight_to_response(insight: PortfolioInsight) -> PortfolioInsightResponse:
    def _parse_json(val: str | None) -> list | dict | None:
        if val is None:
            return None
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return None

    allocation_raw = _parse_json(insight.allocation_breakdown) or []
    allocation = [AllocationEntry(**a) for a in allocation_raw]

    sector_raw = _parse_json(insight.sector_breakdown) or []
    sector_breakdown = [SectorEntry(**s) for s in sector_raw] if sector_raw else None

    concentration_raw = _parse_json(insight.concentration_metrics) or {}
    concentration = ConcentrationMetrics(**concentration_raw)

    return PortfolioInsightResponse(
        id=insight.id,
        job_id=insight.job_id,
        user_id=insight.user_id,
        total_value=insight.total_value,
        total_cost_basis=insight.total_cost_basis,
        total_pnl=insight.total_pnl,
        total_pnl_pct=insight.total_pnl_pct,
        allocation_breakdown=allocation,
        sector_breakdown=sector_breakdown,
        concentration_metrics=concentration,
        risk_assessment=_parse_json(insight.risk_assessment),
        summary=insight.summary,
        strengths=_parse_json(insight.strengths),
        weaknesses=_parse_json(insight.weaknesses),
        action_items=_parse_json(insight.action_items),
        created_at=insight.created_at,
    )


def _rec_to_response(r: Recommendation) -> RecommendationResponse:
    tags = None
    if r.tags:
        try:
            tags = json.loads(r.tags)
        except (json.JSONDecodeError, TypeError):
            tags = None

    return RecommendationResponse(
        id=r.id,
        job_id=r.job_id,
        user_id=r.user_id,
        ticker=r.ticker,
        order_type=r.order_type,
        side=r.side,
        quantity=r.quantity,
        limit_price=r.limit_price,
        stop_price=r.stop_price,
        time_in_force=r.time_in_force,
        expiration=r.expiration,
        condition_text=r.condition_text,
        confidence=r.confidence,
        rationale=r.rationale,
        priority=r.priority,
        tags=tags,
        status=r.status,
        status_changed_at=r.status_changed_at,
        status_note=r.status_note,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _suggestion_to_response(s: StockSuggestion) -> StockSuggestionResponse:
    return StockSuggestionResponse(
        id=s.id,
        job_id=s.job_id,
        user_id=s.user_id,
        ticker=s.ticker,
        company_name=s.company_name,
        sector=s.sector,
        industry=s.industry,
        rationale=s.rationale,
        gap_type=s.gap_type,
        current_price=s.current_price,
        market_cap=s.market_cap,
        pe_ratio=s.pe_ratio,
        dividend_yield=s.dividend_yield,
        suggested_weight=s.suggested_weight,
        suggested_shares=s.suggested_shares,
        status=s.status,
        status_changed_at=s.status_changed_at,
        created_at=s.created_at,
    )
