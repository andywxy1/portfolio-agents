#!/bin/bash
set -e

# ============================================================================
# Portfolio Agents - Setup
# Installs backend and frontend dependencies, initializes database.
# Does NOT start the server. Use start.sh for that.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

step() { echo -e "\n${CYAN}${BOLD}==> $1${RESET}"; }
info() { echo -e "    ${DIM}$1${RESET}"; }
ok()   { echo -e "    ${GREEN}OK${RESET} $1"; }
warn() { echo -e "    ${YELLOW}WARNING${RESET} $1"; }
fail() { echo -e "\n    ${RED}ERROR${RESET} $1"; exit 1; }

echo ""
echo -e "${BOLD}  Portfolio Agents - Setup${RESET}"
echo "  ========================"

# --------------------------------------------------------------------------
# 1. Check prerequisites
# --------------------------------------------------------------------------
step "Checking prerequisites"

if command -v python3.13 &>/dev/null; then
    ok "Python 3.13 found: $(python3.13 --version 2>&1)"
else
    fail "Python 3.13 is required but not found. Install it first."
fi

if command -v node &>/dev/null; then
    ok "Node.js found: $(node --version)"
else
    fail "Node.js is required but not found. Install it first."
fi

if command -v npm &>/dev/null; then
    ok "npm found: $(npm --version)"
else
    fail "npm is required but not found."
fi

# --------------------------------------------------------------------------
# 2. Backend: Python venv + dependencies
# --------------------------------------------------------------------------
step "Setting up backend"

VENV_CREATED=false
if [ ! -d "backend/.venv" ]; then
    info "Creating Python 3.13 virtual environment..."
    python3.13 -m venv backend/.venv
    VENV_CREATED=true
    ok "Virtual environment created"
else
    ok "Virtual environment already exists"
fi

source backend/.venv/bin/activate

if [ "$VENV_CREATED" = true ]; then
    info "Installing Python dependencies..."
    pip install -q -r backend/requirements.txt
    ok "Python dependencies installed"
else
    ok "Python dependencies already installed (delete backend/.venv to reinstall)"
fi

# Install tradingagents if available
if [ -d "$HOME/TradingAgents" ]; then
    info "Installing tradingagents package..."
    pip install -q "$HOME/TradingAgents"
    ok "tradingagents installed"
else
    warn "~/TradingAgents not found. Agent pipeline will not work without it."
    info "Clone it: git clone https://github.com/TauricResearch/TradingAgents.git ~/TradingAgents"
fi

# --------------------------------------------------------------------------
# 3. Backend: data directory + database
# --------------------------------------------------------------------------
step "Initializing database"

mkdir -p backend/data

if [ ! -f "backend/data/portfolio.db" ]; then
    info "Creating database from schema..."
    (cd backend && .venv/bin/python -c "from app.database import init_db; init_db()")
    ok "Database created at backend/data/portfolio.db"
else
    ok "Database already exists"
fi

# --------------------------------------------------------------------------
# 4. Frontend: npm install + build
# --------------------------------------------------------------------------
step "Setting up frontend"

if [ ! -d "frontend/node_modules" ]; then
    info "Installing npm dependencies..."
    (cd frontend && npm install --silent)
    ok "npm dependencies installed"
else
    ok "npm dependencies already installed"
fi

# Build frontend if dist/ is missing or any src/ file is newer than dist/
NEEDS_BUILD=false
if [ ! -d "frontend/dist" ]; then
    NEEDS_BUILD=true
    info "No dist/ directory found, building..."
elif [ -n "$(find frontend/src -newer frontend/dist -print -quit 2>/dev/null)" ]; then
    NEEDS_BUILD=true
    info "Source files changed since last build, rebuilding..."
else
    ok "Frontend build is up to date"
fi

if [ "$NEEDS_BUILD" = true ]; then
    info "Building frontend..."
    (cd frontend && npm run build)
    ok "Frontend built to frontend/dist/"
fi

# --------------------------------------------------------------------------
# Done
# --------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}  Setup complete!${RESET}"
echo ""
echo "  To start the server:  ./start.sh"
echo "  To configure API keys: edit backend/.env"
echo ""
