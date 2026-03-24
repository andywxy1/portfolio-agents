# Portfolio Agents

AI-powered portfolio analysis using multi-agent LLM systems.

> Inspired by [TradingAgents](https://github.com/TauricResearch/TradingAgents) by Tauric Research

## Screenshots

<!-- TODO: Add screenshots -->

## Features

- **Holdings Management** -- Import and track portfolio positions with real-time pricing via Alpaca
- **Multi-Agent Analysis** -- Tiered LLM analysis (deep/standard/light) based on position weight
- **Order Recommendations** -- Structured buy/sell/hold recommendations via function calling
- **Portfolio Insights** -- Sector allocation, concentration metrics, and risk commentary
- **Stock Suggestions** -- Sector-gap analysis to identify diversification opportunities

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | FastAPI, SQLAlchemy, LangGraph      |
| Frontend  | React 19, TypeScript, TailwindCSS 4 |
| Database  | SQLite                              |
| Market Data | Alpaca API                        |
| LLM       | OpenAI-compatible API (any provider)|
| Charts    | Recharts                            |

## Prerequisites

- Python 3.13+
- Node.js 18+
- An [Alpaca](https://alpaca.markets/) account (paper trading works)
- Access to an OpenAI-compatible LLM API

## Quick Start

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Initialize database
sqlite3 data/portfolio.db < schema.sql

# Start server
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install

# Configure API endpoint (optional -- defaults to localhost:8000)
echo "VITE_API_KEY=your-backend-api-key" > .env

# Development
npm run dev

# Production build
npm run build
```

The UI will be available at `http://localhost:5173`.

## Configuration

All configuration is via environment variables. See `.env.example` files in the backend directory.

| Variable | Description |
|----------|-------------|
| `API_KEY` | Shared secret for frontend-to-backend auth |
| `DATABASE_URL` | SQLite connection string |
| `ALPACA_API_KEY` | Alpaca API key for market data |
| `ALPACA_SECRET_KEY` | Alpaca secret key |
| `ALPACA_BASE_URL` | Alpaca endpoint (paper or live) |
| `LLM_BASE_URL` | OpenAI-compatible API base URL |
| `LLM_API_KEY` | LLM provider API key |
| `LLM_DEEP_MODEL` | Model for deep analysis (heavy positions) |
| `LLM_QUICK_MODEL` | Model for standard/light analysis |
| `OPENAI_API_KEY` | Required by LangGraph (can match `LLM_API_KEY`) |
| `WEIGHT_HEAVY_THRESHOLD` | Position weight threshold for deep analysis (default: 0.10) |
| `WEIGHT_MEDIUM_THRESHOLD` | Position weight threshold for standard analysis (default: 0.03) |

## Project Structure

```
portfolio-agents/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application entry
│   │   ├── config.py            # Settings via pydantic-settings
│   │   ├── database.py          # SQLAlchemy engine & session
│   │   ├── models/              # ORM models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── routers/             # API route handlers
│   │   ├── services/            # Business logic & agent pipeline
│   │   └── middleware/          # Auth middleware
│   ├── data/                    # SQLite database (gitignored)
│   ├── schema.sql               # Database DDL
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── pages/               # Route pages
│   │   ├── components/          # Reusable UI components
│   │   ├── api/                 # API client layer
│   │   ├── types/               # TypeScript type definitions
│   │   └── App.tsx              # Router & layout
│   ├── package.json
│   └── vite.config.ts
├── .env.example                 # All environment variables reference
├── .gitignore
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE)
