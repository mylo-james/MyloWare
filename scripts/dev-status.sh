#!/bin/bash

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 MCP Development Environment Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Docker containers
echo "🐳 Docker Containers:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose ps
echo ""

# Check MCP server
echo "🖥️  MCP Server:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -f .mcp-server.pid ]; then
  MCP_PID=$(cat .mcp-server.pid)
  if ps -p $MCP_PID > /dev/null 2>&1; then
    echo "  Status: ✅ Running (PID: $MCP_PID)"
  else
    echo "  Status: ❌ Not running (stale PID file)"
  fi
else
  echo "  Status: ❌ Not running"
fi

# Check if port 3456 is actually in use
if lsof -i :3456 > /dev/null 2>&1; then
  echo "  Port 3456: ✅ Listening"
else
  echo "  Port 3456: ❌ Nothing listening"
fi

# Check health endpoint
if curl -sf http://localhost:3456/health > /dev/null 2>&1; then
  echo "  Health: ✅ Responding"
else
  echo "  Health: ❌ Not responding"
fi
echo ""

# Check PostgreSQL
echo "🗄️  PostgreSQL:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if docker compose exec -T postgres pg_isready -U postgres -d mcp > /dev/null 2>&1; then
  echo "  Status: ✅ Ready"
  # Get database size
  SIZE=$(docker compose exec -T postgres psql -U postgres -d mcp -t -c "SELECT pg_size_pretty(pg_database_size('mcp'));" 2>/dev/null | xargs || echo "unknown")
  echo "  Database size: $SIZE"
else
  echo "  Status: ❌ Not ready"
fi
echo ""

# Check n8n
echo "🔄 n8n:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if curl -sf http://localhost:5678 > /dev/null 2>&1; then
  echo "  Status: ✅ Running"
  echo "  URL: http://localhost:5678"
else
  echo "  Status: ❌ Not responding"
fi
echo ""

# Check Cloudflare tunnel
echo "☁️  Cloudflare Tunnel:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if docker compose ps cloudflared | grep -q "Up"; then
  echo "  Status: ✅ Running"
  if curl -sf https://mcp-vector.mjames.dev/health > /dev/null 2>&1; then
    echo "  External access: ✅ Working"
  else
    echo "  External access: ⚠️  Tunnel running but MCP not responding"
  fi
else
  echo "  Status: ❌ Not running"
fi
echo ""

