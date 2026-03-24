#!/bin/bash
set -e

echo "=== Portfolio Agents Frontend Setup ==="
echo ""

cd "$(dirname "$0")"

# Install dependencies
echo "Installing dependencies..."
npm install

# Create .env if missing
if [ ! -f ".env" ]; then
    cat > .env << 'EOF'
VITE_API_BASE_URL=http://localhost:8000
VITE_API_KEY=dev-api-key-change-me
VITE_USE_MOCKS=false
EOF
    echo "Created .env — set VITE_API_KEY to match your backend API_KEY"
else
    echo ".env already configured."
fi

echo ""
echo "=== Setup complete ==="
echo "Run: ./start.sh"
