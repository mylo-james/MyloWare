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

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found"
    echo ""
    echo "Please copy .env.example to .env and configure:"
    echo "  cp .env.example .env"
    echo ""
    exit 1
fi

echo "✅ Found .env file"

# Stop production containers
echo "🧹 Stopping production containers..."
docker stop mcp-server 2>/dev/null || true
docker rm mcp-server 2>/dev/null || true

# Clean up any existing dev containers
echo "🧹 Cleaning up old containers..."
docker compose down --remove-orphans 2>/dev/null || true

# Start PostgreSQL and n8n first
echo "🐘 Starting PostgreSQL and n8n..."
docker compose up -d mcp-postgres n8n

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be healthy..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if docker exec mcp-postgres pg_isready -U mylo -d memories &>/dev/null; then
        echo "✅ PostgreSQL is ready"
        break
    fi
    attempt=$((attempt + 1))
    if [ $attempt -eq $max_attempts ]; then
        echo "❌ PostgreSQL failed to become healthy"
        exit 1
    fi
    echo "   Waiting... (${attempt}/${max_attempts})"
    sleep 2
done

# Bootstrap database (migrate + seed if needed)
echo "🌱 Bootstrapping database..."
npm run db:bootstrap -- --seed

# Seed workflow mappings
echo "📋 Seeding workflow mappings..."
npm run db:seed:workflows || echo "⚠️  Workflow mappings seed skipped (may already exist)"

# Validate database setup
echo "🔍 Validating database setup..."
PERSONA_COUNT=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM personas;")
PROJECT_COUNT=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM projects;")
WEBHOOK_COUNT=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM agent_webhooks;")

echo "   ✓ Personas: $PERSONA_COUNT"
echo "   ✓ Projects: $PROJECT_COUNT"
echo "   ✓ Webhooks: $WEBHOOK_COUNT"

if [ "$PERSONA_COUNT" -lt 6 ] || [ "$PROJECT_COUNT" -lt 4 ]; then
    echo "❌ Database seed validation failed!"
    exit 1
fi

echo "✅ Database is ready"

# Start MCP server in dev mode with hot reload
echo "🚀 Starting MCP server with hot reload..."
npm run dev

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
echo "🔍 Check health: curl http://localhost:3456/health"
echo "🛑 Stop:         Press Ctrl+C"
echo "📖 Guide:        cat DEV_GUIDE.md"
echo ""

