#!/bin/bash
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     Portfolio Agents - Setup         ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")"

# --- Python venv ---
if [ ! -d ".venv" ]; then
    echo "Creating Python 3.13 virtual environment..."
    python3.13 -m venv .venv
else
    echo "Virtual environment already exists."
fi

source .venv/bin/activate

echo "Installing dependencies..."
pip install -q -r requirements.txt

# Install tradingagents
if [ -d "$HOME/TradingAgents" ]; then
    echo "Installing tradingagents package..."
    pip install -q "$HOME/TradingAgents"
else
    echo ""
    echo "⚠  ~/TradingAgents not found. Agent pipeline will not work without it."
    echo "   Clone it: git clone https://github.com/TauricResearch/TradingAgents.git ~/TradingAgents"
    echo ""
fi

# Create data directory
mkdir -p data

# --- Interactive .env setup ---
if [ -f ".env" ]; then
    echo ""
    read -p "An .env file already exists. Reconfigure? [y/N]: " reconfigure
    if [[ ! "$reconfigure" =~ ^[Yy]$ ]]; then
        # Just init DB and exit
        if [ ! -f "data/portfolio.db" ]; then
            echo "Initializing database..."
            python -c "from app.database import init_db; init_db()"
        fi
        echo ""
        echo "✓ Setup complete. Run: ./start.sh"
        exit 0
    fi
fi

echo ""
echo "─── API Keys Configuration ───"
echo ""
echo "Press Enter to keep the default value shown in [brackets]."
echo ""

# Alpaca
echo "┌─ Alpaca (market data) ─────────────────"
echo "│  Get keys at: https://app.alpaca.markets/brokerage/dashboard/overview"
read -p "│  API Key: " alpaca_key
read -p "│  Secret Key: " alpaca_secret
read -p "│  Base URL [https://paper-api.alpaca.markets]: " alpaca_url
alpaca_url=${alpaca_url:-https://paper-api.alpaca.markets}
echo "└────────────────────────────────────────"

echo ""

# LLM
echo "┌─ LLM Proxy ────────────────────────────"
read -p "│  Base URL [http://10.0.0.126:8317/v1]: " llm_url
llm_url=${llm_url:-http://10.0.0.126:8317/v1}
read -p "│  API Key: " llm_key
echo "│"
echo "│  Available models depend on your proxy."
echo "│  Examples: claude-sonnet-4-6, claude-opus-4-6, gpt-5-mini"
read -p "│  Quick model (fast, cheap) [claude-sonnet-4-6]: " llm_quick
llm_quick=${llm_quick:-claude-sonnet-4-6}
read -p "│  Deep model (smart, thorough) [claude-sonnet-4-6]: " llm_deep
llm_deep=${llm_deep:-claude-sonnet-4-6}
echo "└────────────────────────────────────────"

echo ""

# App auth
echo "┌─ App Settings ─────────────────────────"
read -p "│  API Key for this app [auto-generated]: " app_key
if [ -z "$app_key" ]; then
    app_key=$(python -c "import secrets; print(secrets.token_hex(16))")
    echo "│  Generated: $app_key"
fi
read -p "│  Port [8000]: " port
port=${port:-8000}
echo "└────────────────────────────────────────"

echo ""

# Analysis thresholds
echo "┌─ Analysis Thresholds (optional) ───────"
echo "│  Positions above heavy threshold get full multi-agent analysis."
echo "│  Positions below medium threshold get quick scan only."
read -p "│  Heavy threshold [0.10]: " heavy
heavy=${heavy:-0.10}
read -p "│  Medium threshold [0.03]: " medium
medium=${medium:-0.03}
echo "└────────────────────────────────────────"

# Write .env
cat > .env << EOF
# Server
HOST=0.0.0.0
PORT=$port

# Auth
API_KEY=$app_key

# Database
DATABASE_URL=sqlite:///data/portfolio.db

# Alpaca Market Data
ALPACA_API_KEY=$alpaca_key
ALPACA_SECRET_KEY=$alpaca_secret
ALPACA_BASE_URL=$alpaca_url

# LLM Proxy
LLM_BASE_URL=$llm_url
LLM_API_KEY=$llm_key
LLM_DEEP_MODEL=$llm_deep
LLM_QUICK_MODEL=$llm_quick

# Required by OpenAI SDK internally
OPENAI_API_KEY=$llm_key

# Analysis Weight Thresholds
WEIGHT_HEAVY_THRESHOLD=$heavy
WEIGHT_MEDIUM_THRESHOLD=$medium

# Analysis Config
MAX_DEBATE_ROUNDS=1
MAX_RISK_DISCUSS_ROUNDS=1
EOF

echo ""
echo "✓ Configuration saved to .env"

# --- Database ---
if [ ! -f "data/portfolio.db" ]; then
    echo "Initializing database..."
    python -c "from app.database import init_db; init_db()"
    echo "✓ Database created"
else
    echo "✓ Database already exists"
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║         Setup Complete!              ║"
echo "  ╠══════════════════════════════════════╣"
echo "  ║  Backend:  ./start.sh               ║"
echo "  ║  API docs: http://localhost:$port/docs  ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
