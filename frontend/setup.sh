#!/bin/bash
set -e

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   Portfolio Agents Frontend Setup    ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

if [ -f ".env" ]; then
    read -p "An .env file already exists. Reconfigure? [y/N]: " reconfigure
    if [[ ! "$reconfigure" =~ ^[Yy]$ ]]; then
        echo ""
        echo "✓ Setup complete. Run: ./start.sh"
        exit 0
    fi
fi

echo ""
echo "─── Frontend Configuration ───"
echo ""

read -p "Backend URL [http://localhost:8000]: " api_url
api_url=${api_url:-http://localhost:8000}

read -p "API Key (must match backend API_KEY): " api_key
api_key=${api_key:-dev-api-key-change-me}

read -p "Use mock data instead of real backend? [y/N]: " use_mocks
if [[ "$use_mocks" =~ ^[Yy]$ ]]; then
    mocks="true"
else
    mocks="false"
fi

cat > .env << EOF
VITE_API_BASE_URL=$api_url
VITE_API_KEY=$api_key
VITE_USE_MOCKS=$mocks
EOF

echo ""
echo "✓ Configuration saved to .env"
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║         Setup Complete!              ║"
echo "  ╠══════════════════════════════════════╣"
echo "  ║  Run: ./start.sh                    ║"
echo "  ║  URL: http://localhost:5173         ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
