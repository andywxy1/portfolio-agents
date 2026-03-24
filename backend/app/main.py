"""FastAPI application entry point.

Configures CORS, registers routers, and initializes the database on startup.
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import init_db
from app.routers import (
    analysis,
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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application startup and shutdown lifecycle."""
    logger.info("Initializing database...")
    init_db()
    logger.info("Database initialized. Server ready.")
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="portfolio-agents",
    description="AI-powered portfolio analysis backend",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS -- allow Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
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
    """Health check endpoint (no auth required)."""
    return {"status": "ok", "version": "1.0.0"}
