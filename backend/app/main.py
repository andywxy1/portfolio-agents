"""FastAPI application entry point.

Configures CORS, registers routers, serves the frontend SPA,
and initializes the database on startup.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal, init_db
from app.routers import (
    analysis,
    config,
    holdings,
    portfolio,
    prices,
    recommendations,
    reports,
    suggestions,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _cleanup_stale_price_cache() -> None:
    """Delete price_cache entries older than 7 days."""
    db = SessionLocal()
    try:
        db.execute(
            text(
                "DELETE FROM price_cache "
                "WHERE fetched_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')"
            )
        )
        db.commit()
        logger.info("Cleaned up stale price cache entries")
    except Exception:
        logger.exception("Failed to clean up price cache")
    finally:
        db.close()


def _add_mode_column_if_missing() -> None:
    """Add the `mode` column to analysis_jobs if it doesn't exist yet.

    This handles upgrades from older schema versions.
    """
    db = SessionLocal()
    try:
        # Check if column exists
        result = db.execute(text("PRAGMA table_info(analysis_jobs)")).fetchall()
        column_names = [row[1] for row in result]
        if "mode" not in column_names:
            db.execute(
                text("ALTER TABLE analysis_jobs ADD COLUMN mode TEXT DEFAULT 'portfolio'")
            )
            db.commit()
            logger.info("Added 'mode' column to analysis_jobs table")
    except Exception:
        logger.exception("Failed to add mode column")
    finally:
        db.close()


def _recover_stuck_jobs() -> None:
    """Mark any pending/running jobs as failed.

    These are zombie jobs left over from a previous process crash or
    ungraceful shutdown.  Without this, the 409 rate-limit would block
    users from starting new analyses.
    """
    db = SessionLocal()
    try:
        result = db.execute(
            text(
                "UPDATE analysis_jobs "
                "SET status = 'failed', "
                "    error_message = 'Server restarted during analysis', "
                "    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
                "WHERE status IN ('pending', 'running')"
            )
        )
        db.commit()
        if result.rowcount:
            logger.info("Recovered %d stuck analysis job(s)", result.rowcount)
    except Exception:
        logger.exception("Failed to recover stuck jobs")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle."""
    logger.info("Initializing database...")
    init_db()
    _add_mode_column_if_missing()
    logger.info("Database initialized. Recovering stuck jobs...")
    _recover_stuck_jobs()
    logger.info("Cleaning up stale cache...")
    _cleanup_stale_price_cache()
    logger.info("Server ready.")
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="portfolio-agents",
    description="AI-powered portfolio analysis backend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS -- configurable origins with sane defaults
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_cors_origins = getattr(settings, "cors_origins", None) or _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(config.router)
app.include_router(holdings.router)
app.include_router(analysis.router)
app.include_router(recommendations.router)
app.include_router(portfolio.router)
app.include_router(reports.router)
app.include_router(suggestions.router)
app.include_router(prices.router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all exception handler for unhandled errors."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred. Please try again later.",
            }
        },
    )


@app.get("/api/health")
async def health_check() -> dict:
    """Health check endpoint (no auth required). Verifies DB connectivity."""
    try:
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        finally:
            db.close()
    except Exception:
        db_ok = False

    status = "ok" if db_ok else "degraded"
    return {"status": status, "version": "1.0.0", "database": "ok" if db_ok else "error"}


# ---------------------------------------------------------------------------
# Serve the frontend SPA (must be registered AFTER all API routers)
# ---------------------------------------------------------------------------
_frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"

if _frontend_dist.exists():
    # Serve /assets (JS, CSS, images) as static files
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve index.html for all non-API, non-asset routes (SPA routing)."""
        # If the exact file exists in dist (e.g. favicon.ico), serve it directly
        file_path = _frontend_dist / full_path
        # Guard against path traversal (e.g. ../../etc/passwd)
        if not file_path.resolve().is_relative_to(_frontend_dist.resolve()):
            return FileResponse(_frontend_dist / "index.html")
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_frontend_dist / "index.html")
