"""Analysis job endpoints.

POST   /api/analysis/start       -> start a new analysis job
GET    /api/analysis/jobs/:id    -> get job status and results
GET    /api/analysis/latest      -> get the latest completed analysis
"""

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import require_api_key
from app.models.analysis import AnalysisJob, PortfolioInsight, PositionAnalysis
from app.models.holding import Holding
from app.models.recommendation import Recommendation
from app.models.suggestion import StockSuggestion
from app.schemas.analysis import (
    AnalysisJobConfig,
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

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


@router.post("/start", response_model=StartAnalysisResponse, status_code=201)
def start_analysis(
    body: StartAnalysisRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(require_api_key),
) -> StartAnalysisResponse:
    """Start a new background analysis job."""
    # Determine tickers
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

    job = AnalysisJob(
        id=str(uuid.uuid4()),
        user_id=user_id,
        status="pending",
        tickers=json.dumps(tickers),
        total_tickers=len(tickers),
        completed_tickers=0,
        config=json.dumps(config_dict) if config_dict else None,
        created_at=_now(),
    )
    db.add(job)
    db.commit()

    # Submit to background runner
    get_runner().submit_job(job.id, config_dict)

    return StartAnalysisResponse(
        job_id=job.id,
        status=job.status,
        tickers=tickers,
        total_tickers=len(tickers),
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
