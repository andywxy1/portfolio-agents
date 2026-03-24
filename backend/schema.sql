-- portfolio-agents Database Schema
-- SQLite with WAL mode for concurrent read/write
-- All user-scoped tables include user_id for future multi-user support

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- HOLDINGS
-- User's portfolio positions. Soft-deletable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS holdings (
    id              TEXT PRIMARY KEY,                          -- UUID as text
    user_id         TEXT NOT NULL DEFAULT 'default',
    ticker          TEXT NOT NULL,
    shares          REAL NOT NULL CHECK (shares > 0),         -- fractional shares supported
    buy_price       REAL NOT NULL CHECK (buy_price >= 0),     -- average cost basis per share
    notes           TEXT,                                      -- optional user notes
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at      TEXT                                       -- soft delete timestamp
);

-- One active holding per ticker per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_user_ticker
    ON holdings(user_id, ticker) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_holdings_user_active
    ON holdings(user_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- ANALYSIS JOBS
-- Tracks background analysis execution. One job covers multiple tickers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS analysis_jobs (
    id              TEXT PRIMARY KEY,                          -- UUID
    user_id         TEXT NOT NULL DEFAULT 'default',
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    tickers         TEXT NOT NULL,                             -- JSON array of tickers analyzed
    total_tickers   INTEGER NOT NULL DEFAULT 0,
    completed_tickers INTEGER NOT NULL DEFAULT 0,
    config          TEXT,                                      -- JSON: analysis config (depth overrides, etc.)
    error_message   TEXT,                                      -- populated on failure
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at      TEXT,
    completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_user_status
    ON analysis_jobs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_user_created
    ON analysis_jobs(user_id, created_at DESC);

-- ============================================================================
-- POSITION ANALYSES
-- Per-ticker analysis results linked to an analysis job.
-- ============================================================================

CREATE TABLE IF NOT EXISTS position_analyses (
    id              TEXT PRIMARY KEY,                          -- UUID
    job_id          TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL DEFAULT 'default',
    ticker          TEXT NOT NULL,
    analysis_depth  TEXT NOT NULL DEFAULT 'full'
                        CHECK (analysis_depth IN ('full', 'standard', 'quick')),
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'completed', 'failed')),

    -- Core decision output
    signal          TEXT CHECK (signal IN ('BUY', 'OVERWEIGHT', 'HOLD', 'UNDERWEIGHT', 'SELL')),
    raw_decision    TEXT,                                      -- full text of final trade decision

    -- Structured analysis results (JSON blobs)
    market_report       TEXT,                                  -- JSON
    sentiment_report    TEXT,                                  -- JSON
    news_report         TEXT,                                  -- JSON
    fundamentals_report TEXT,                                  -- JSON
    investment_debate   TEXT,                                  -- JSON: bull/bear/judge
    risk_debate         TEXT,                                  -- JSON: aggressive/conservative/neutral/judge
    investment_plan     TEXT,                                  -- JSON

    -- Price snapshot at time of analysis
    current_price   REAL,
    price_change_pct REAL,                                    -- daily change %

    error_message   TEXT,                                      -- populated on failure
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_position_analyses_job
    ON position_analyses(job_id);

CREATE INDEX IF NOT EXISTS idx_position_analyses_user_ticker
    ON position_analyses(user_id, ticker, created_at DESC);

-- Latest completed analysis per ticker (for dashboard)
CREATE INDEX IF NOT EXISTS idx_position_analyses_latest
    ON position_analyses(user_id, ticker, completed_at DESC)
    WHERE status = 'completed';

-- ============================================================================
-- RECOMMENDATIONS
-- Order recommendations generated by the LLM via function calling.
-- Linked to analysis jobs but managed independently (accept/dismiss lifecycle).
-- ============================================================================

CREATE TABLE IF NOT EXISTS recommendations (
    id              TEXT PRIMARY KEY,                          -- UUID
    job_id          TEXT REFERENCES analysis_jobs(id) ON DELETE SET NULL,
    user_id         TEXT NOT NULL DEFAULT 'default',
    ticker          TEXT NOT NULL,

    -- Order parameters
    order_type      TEXT NOT NULL CHECK (order_type IN ('market', 'limit', 'stop', 'stop_limit', 'conditional')),
    side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity        REAL NOT NULL CHECK (quantity > 0),        -- shares to trade
    limit_price     REAL,                                      -- for limit / stop_limit orders
    stop_price      REAL,                                      -- for stop / stop_limit orders
    time_in_force   TEXT NOT NULL DEFAULT 'day'
                        CHECK (time_in_force IN ('day', 'gtc', 'ioc', 'fok')),
    expiration      TEXT,                                      -- ISO date: recommendation expires after this

    -- Condition for conditional orders (e.g., "if AAPL drops below $150")
    condition_text  TEXT,

    -- Decision metadata
    confidence      REAL CHECK (confidence >= 0 AND confidence <= 1),  -- 0.0 to 1.0
    rationale       TEXT NOT NULL,                             -- why this recommendation
    priority        INTEGER NOT NULL DEFAULT 0,                -- higher = more important
    tags            TEXT,                                       -- JSON array of tags

    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'dismissed', 'expired', 'executed')),
    status_changed_at TEXT,
    status_note     TEXT,                                      -- user's note on accept/dismiss

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user_status
    ON recommendations(user_id, status);

CREATE INDEX IF NOT EXISTS idx_recommendations_user_ticker
    ON recommendations(user_id, ticker, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendations_job
    ON recommendations(job_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_pending
    ON recommendations(user_id, created_at DESC)
    WHERE status = 'pending';

-- ============================================================================
-- PORTFOLIO INSIGHTS
-- Portfolio-level analysis results (concentration, exposure, etc.)
-- One row per analysis job.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_insights (
    id              TEXT PRIMARY KEY,                          -- UUID
    job_id          TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL DEFAULT 'default',

    -- Portfolio metrics (all JSON)
    total_value         REAL,
    total_cost_basis    REAL,
    total_pnl           REAL,
    total_pnl_pct       REAL,

    -- Allocation analysis
    allocation_breakdown TEXT NOT NULL,                        -- JSON: [{ticker, shares, value, weight, pnl, pnl_pct}]
    sector_breakdown     TEXT,                                 -- JSON: [{sector, weight, tickers}]

    -- Concentration metrics
    concentration_metrics TEXT NOT NULL,                       -- JSON: {hhi, top3_weight, top5_weight, max_position_weight}

    -- Risk assessment
    risk_assessment     TEXT,                                  -- JSON: risk factors, diversification score, etc.

    -- Overall portfolio narrative from LLM
    summary             TEXT NOT NULL,                         -- markdown summary
    strengths           TEXT,                                  -- JSON array of strength observations
    weaknesses          TEXT,                                  -- JSON array of weakness observations
    action_items        TEXT,                                  -- JSON array of suggested actions

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_portfolio_insights_user
    ON portfolio_insights(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_insights_job
    ON portfolio_insights(job_id);

-- ============================================================================
-- REPORTS
-- Stored agent reports for history and audit trail.
-- Each position analysis may generate multiple reports (one per agent stage).
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
    id              TEXT PRIMARY KEY,                          -- UUID
    job_id          TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    position_analysis_id TEXT REFERENCES position_analyses(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL DEFAULT 'default',
    ticker          TEXT NOT NULL,

    -- Report classification
    report_type     TEXT NOT NULL
                        CHECK (report_type IN (
                            'market_analysis',
                            'sentiment_analysis',
                            'news_analysis',
                            'fundamentals_analysis',
                            'investment_debate',
                            'risk_debate',
                            'investment_plan',
                            'final_decision',
                            'portfolio_overview'
                        )),

    -- Content
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,                             -- JSON: structured report content
    summary         TEXT,                                      -- short plain-text summary

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_job
    ON reports(job_id);

CREATE INDEX IF NOT EXISTS idx_reports_user_ticker
    ON reports(user_id, ticker, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_user_type
    ON reports(user_id, report_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_position_analysis
    ON reports(position_analysis_id);

-- ============================================================================
-- PRICE CACHE
-- Cached price data from Alpaca and computed indicators.
-- TTL enforced at application layer (60s market hours, 24h off-hours).
-- ============================================================================

CREATE TABLE IF NOT EXISTS price_cache (
    id              TEXT PRIMARY KEY,                          -- UUID
    ticker          TEXT NOT NULL,

    -- Price data
    price           REAL NOT NULL,
    open            REAL,
    high            REAL,
    low             REAL,
    close           REAL,
    volume          INTEGER,

    -- Change metrics
    change          REAL,                                      -- absolute change
    change_pct      REAL,                                      -- percentage change

    -- Technical indicators (JSON blob, computed from yfinance data)
    indicators      TEXT,                                      -- JSON: {sma_20, sma_50, rsi_14, macd, ...}

    -- Market context
    market_status   TEXT CHECK (market_status IN ('open', 'closed', 'pre', 'post')),

    fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Latest price per ticker (most common query)
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_cache_ticker_latest
    ON price_cache(ticker, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_cache_ticker
    ON price_cache(ticker);

-- Cleanup: keep only last 7 days of price history per ticker
-- (enforced by periodic cleanup task at application layer)

-- ============================================================================
-- STOCK SUGGESTIONS
-- New stock suggestions based on sector-gap analysis.
-- Linked to analysis jobs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_suggestions (
    id              TEXT PRIMARY KEY,                          -- UUID
    job_id          TEXT REFERENCES analysis_jobs(id) ON DELETE SET NULL,
    user_id         TEXT NOT NULL DEFAULT 'default',
    ticker          TEXT NOT NULL,
    company_name    TEXT NOT NULL,

    -- Why this stock
    sector          TEXT NOT NULL,
    industry        TEXT,
    rationale       TEXT NOT NULL,                             -- why the suggestion fits the portfolio
    gap_type        TEXT NOT NULL
                        CHECK (gap_type IN ('sector_gap', 'diversification', 'opportunity', 'hedge')),

    -- Basic metrics at time of suggestion
    current_price   REAL,
    market_cap      REAL,
    pe_ratio        REAL,
    dividend_yield  REAL,

    -- Suggested allocation
    suggested_weight REAL,                                     -- target portfolio weight (0.0 to 1.0)
    suggested_shares REAL,                                     -- suggested number of shares

    -- Lifecycle
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'added', 'dismissed', 'expired')),
    status_changed_at TEXT,

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_suggestions_user_status
    ON stock_suggestions(user_id, status);

CREATE INDEX IF NOT EXISTS idx_stock_suggestions_user_created
    ON stock_suggestions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_suggestions_job
    ON stock_suggestions(job_id);

-- ============================================================================
-- APP METADATA
-- Key-value store for application state (last analysis timestamp, config, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_metadata (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Seed default weight thresholds
INSERT OR IGNORE INTO app_metadata (key, value) VALUES
    ('weight_heavy_threshold', '0.10'),
    ('weight_medium_threshold', '0.03'),
    ('schema_version', '1');
