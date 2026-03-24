#!/bin/bash
set -e

# ============================================================================
# Portfolio Agents - Start
# Single command: setup everything, start backend, open browser.
# The backend serves the frontend's built static files from frontend/dist/.
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
echo -e "${BOLD}  Portfolio Agents${RESET}"
echo "  ================"

# --------------------------------------------------------------------------
# 1. Check prerequisites
# --------------------------------------------------------------------------
step "Checking prerequisites"

if command -v python3.13 &>/dev/null; then
    ok "Python 3.13"
else
    fail "Python 3.13 is required but not found. Install it first."
fi

if command -v node &>/dev/null; then
    ok "Node.js $(node --version)"
else
    fail "Node.js is required but not found. Install it first."
fi

if ! command -v npm &>/dev/null; then
    fail "npm is required but not found."
fi

# --------------------------------------------------------------------------
# 2. Backend: Python venv + dependencies
# --------------------------------------------------------------------------
step "Backend setup"

VENV_CREATED=false
if [ ! -d "backend/.venv" ]; then
    info "Creating Python 3.13 virtual environment..."
    python3.13 -m venv backend/.venv
    VENV_CREATED=true
    ok "Virtual environment created"
else
    ok "Virtual environment exists"
fi

source backend/.venv/bin/activate

if [ "$VENV_CREATED" = true ]; then
    info "Installing Python dependencies..."
    pip install -q -r backend/requirements.txt
    ok "Dependencies installed"
else
    ok "Dependencies already installed"
fi

if [ -d "$HOME/TradingAgents" ]; then
    info "Installing tradingagents package..."
    pip install -q "$HOME/TradingAgents"
    ok "tradingagents installed"
else
    warn "~/TradingAgents not found -- agent pipeline will not work without it."
fi

# --------------------------------------------------------------------------
# 3. Database
# --------------------------------------------------------------------------
step "Database"

mkdir -p backend/data

if [ ! -f "backend/data/portfolio.db" ]; then
    info "Initializing database..."
    (cd backend && .venv/bin/python -c "from app.database import init_db; init_db()")
    ok "Database created"
else
    ok "Database exists"
fi

# --------------------------------------------------------------------------
# 4. Frontend build
# --------------------------------------------------------------------------
step "Frontend"

if [ ! -d "frontend/node_modules" ]; then
    info "Installing npm dependencies..."
    (cd frontend && npm install --silent)
    ok "npm dependencies installed"
else
    ok "npm dependencies present"
fi

NEEDS_BUILD=false
if [ ! -d "frontend/dist" ]; then
    NEEDS_BUILD=true
elif [ -n "$(find frontend/src -newer frontend/dist -print -quit 2>/dev/null)" ]; then
    NEEDS_BUILD=true
fi

if [ "$NEEDS_BUILD" = true ]; then
    info "Building frontend..."
    (cd frontend && npm run build)
    ok "Frontend built"
else
    ok "Frontend build is up to date"
fi

# --------------------------------------------------------------------------
# 5. Resolve port
# --------------------------------------------------------------------------
PORT=8000
if [ -f "backend/.env" ]; then
    ENV_PORT=$(grep -E '^PORT=' backend/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
    if [ -n "$ENV_PORT" ]; then
        PORT="$ENV_PORT"
    fi
fi

# --------------------------------------------------------------------------
# 6. Open browser after short delay (background)
# --------------------------------------------------------------------------
(
    sleep 2
    URL="http://localhost:$PORT"
    if command -v open &>/dev/null; then
        open "$URL"
    elif command -v xdg-open &>/dev/null; then
        xdg-open "$URL"
    fi
) &

# --------------------------------------------------------------------------
# 7. Start server
# --------------------------------------------------------------------------
step "Starting server"
echo ""
echo -e "    ${GREEN}${BOLD}http://localhost:${PORT}${RESET}"
echo -e "    ${DIM}API docs: http://localhost:${PORT}/docs${RESET}"
echo -e "    ${DIM}Press Ctrl+C to stop${RESET}"
echo ""

cd backend
exec uvicorn app.main:app --reload --host 0.0.0.0 --port "$PORT"
