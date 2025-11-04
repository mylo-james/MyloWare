#!/bin/bash
set -e

wait_for_command() {
  local timeout_seconds="$1"
  shift
  local command="$*"
  local start=$(date +%s)

  while true; do
    if eval "$command"; then
      return 0
    fi

    if (( $(date +%s) - start >= timeout_seconds )); then
      return 1
    fi

    sleep 1
  done
}

echo "🚀 Starting MCP Development Environment"
echo ""

# Check for .env file
if [ ! -f .env ]; then
  echo "⚠️  No .env file found. Creating from example..."
  cat > .env << 'EOF'
# Database (connects to Docker postgres on localhost:5432)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mcp
OPERATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/mcp

# OpenAI API
OPENAI_API_KEY=your-openai-key-here

# Server
NODE_ENV=development
SERVER_HOST=0.0.0.0
SERVER_PORT=3456

# Optional: Telegram for n8n workflows
TELEGRAM_BOT_TOKEN=

# Optional: Security
MCP_API_KEY=
EOF
  echo "✅ Created .env file - please edit it with your API keys"
  echo ""
fi

# Stop any existing Docker services
echo "🧹 Stopping existing Docker services..."
docker compose down 2>/dev/null || true

# Stop any running MCP server processes
echo "🧹 Stopping existing MCP server processes..."
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "tsx watch" 2>/dev/null || true

# Start Docker services
echo "🐳 Starting Docker services (postgres, n8n, cloudflared)..."
docker compose up -d

# Wait for postgres to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
if ! wait_for_command 30 "docker compose exec -T postgres pg_isready -U postgres -d mcp > /dev/null 2>&1"; then
  # Try a few more times in case containers are still starting
  sleep 5
  docker compose exec -T postgres pg_isready -U postgres -d mcp > /dev/null 2>&1 || {
    echo "❌ PostgreSQL failed to start. Check logs: npm run dev:logs postgres"
    exit 1
  }
fi

echo "✅ PostgreSQL ready"

# Run migrations
echo "📊 Running database migrations..."
npx tsx scripts/db-utils.ts migrate || {
  echo "⚠️  Main database migrations failed (may already be applied)"
}

npx tsx scripts/db-utils.ts migrate-ops || {
  echo "⚠️  Operations database migrations failed (may already be applied)"
}

# Start MCP server on host
echo "🖥️  Starting MCP server on host..."
npm run dev > logs/dev-server.log 2>&1 &
MCP_PID=$!
echo $MCP_PID > .mcp-server.pid

# Wait for MCP server to be ready
echo "⏳ Waiting for MCP server to start..."
if ! wait_for_command 30 "curl -sf http://localhost:3456/health > /dev/null 2>&1"; then
  echo "❌ MCP server failed to start. Check logs/dev-server.log"
  exit 1
fi

echo ""
echo "✅ Development environment ready!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📍 Access Points:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MCP Server:  http://localhost:3456"
echo "               https://mcp-vector.mjames.dev"
echo "  n8n:         http://localhost:5678"
echo "               https://n8n.mjames.dev"
echo "  PostgreSQL:  localhost:5432 (mcp database)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Management Commands:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  npm run dev:up      - Start everything"
echo "  npm run dev:down    - Stop everything"
echo "  npm run dev:reset   - Reset database"
echo "  npm run dev:logs    - View logs"
echo "  npm run dev:status  - Check status"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Health Check:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -sf http://localhost:3456/health | jq '.' || echo "  (install jq for formatted output)"
echo ""

