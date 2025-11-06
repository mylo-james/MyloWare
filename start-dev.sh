#!/bin/bash
# Start development environment with hot reload

set -e

echo "🔥 Starting Myloware Development Environment with Hot Reload"
echo ""

# Kill any processes using port 3456
echo "🧹 Cleaning up port 3456..."
lsof -ti:3456 | xargs kill -9 2>/dev/null || true
pkill -f "node dist/server.js" 2>/dev/null || true
pkill -f "tsx.*server.ts" 2>/dev/null || true

# Check if Docker is running
echo "🐳 Checking Docker..."
if ! docker ps &>/dev/null; then
    echo "❌ Docker is not running!"
    echo ""
    echo "Please start Docker Desktop:"
    echo "  1. Open Docker Desktop app"
    echo "  2. Wait for it to fully start (whale icon in menu bar)"
    echo "  3. Run this script again: ./start-dev.sh"
    echo ""
    exit 1
fi

echo "✅ Docker is running"

# Stop production containers
echo "🧹 Stopping production containers..."
docker stop mcp-server 2>/dev/null || true
docker rm mcp-server 2>/dev/null || true

# Clean up any existing dev containers
echo "🧹 Cleaning up old containers..."
docker compose down --remove-orphans 2>/dev/null || true

# Start dev environment
echo "🚀 Starting development containers (this may take a minute)..."
echo ""
docker compose --profile dev up --build

echo ""
echo "✅ Development environment is running with HOT RELOAD! 🔥"
echo ""
echo "📝 Your server will AUTO-RELOAD when you change:"
echo "   ✓ src/**/*.ts       - All TypeScript source"
echo "   ✓ scripts/**/*.ts   - Database scripts"  
echo "   ✓ data/**/*.json    - Personas, projects, workflows"
echo "   ✓ *.config.ts       - Config files"
echo ""
echo "🌐 Server:    http://localhost:3456"
echo "🔧 n8n:       http://localhost:5678"
echo "💾 Postgres:  localhost:5432"
echo ""
echo "🔍 Watch logs: npm run dev:docker:logs"
echo "🛑 Stop dev:   npm run dev:stop"
echo "📖 Guide:      cat DEV_GUIDE.md"
echo ""

