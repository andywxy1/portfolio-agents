#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Run ./setup.sh first"
    exit 1
fi

source .venv/bin/activate

if [ ! -f ".env" ]; then
    echo "No .env file found. Run ./setup.sh first"
    exit 1
fi

echo "Starting Portfolio Agents backend on http://localhost:8000"
echo "API docs: http://localhost:8000/docs"
echo "Press Ctrl+C to stop"
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
