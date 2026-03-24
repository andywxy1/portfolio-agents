#!/bin/bash
set -e

echo "=== Portfolio Agents Backend Setup ==="
echo ""

cd "$(dirname "$0")"

# Create virtual environment
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3.13 -m venv .venv
else
    echo "Virtual environment already exists."
fi

source .venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -q -r requirements.txt

# Also install tradingagents from the TradingAgents repo if available
if [ -d "$HOME/TradingAgents" ]; then
    echo "Installing tradingagents package..."
    pip install -q "$HOME/TradingAgents"
else
    echo "WARNING: ~/TradingAgents not found. Agent pipeline will not work."
    echo "  Clone it: git clone https://github.com/TauricResearch/TradingAgents.git ~/TradingAgents"
fi

# Create data directory
mkdir -p data

# Initialize database
if [ ! -f "data/portfolio.db" ]; then
    echo "Initializing database..."
    python -c "from app.database import init_db; init_db()"
    echo "Database created at data/portfolio.db"
else
    echo "Database already exists."
fi

# Create .env if missing
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo ""
    echo "Created .env from template. Edit it with your API keys:"
    echo "  nano $(pwd)/.env"
else
    echo ".env already configured."
fi

echo ""
echo "=== Setup complete ==="
echo "Run: ./start.sh"
