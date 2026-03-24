#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
    echo "Run ./setup.sh first"
    exit 1
fi

echo "Starting Portfolio Agents frontend on http://localhost:5173"
echo "Press Ctrl+C to stop"
echo ""

npm run dev
