#!/bin/bash
set -e

echo "🛑 Stopping MCP Development Environment"
echo ""

# Stop MCP server process
if [ -f .mcp-server.pid ]; then
  MCP_PID=$(cat .mcp-server.pid)
  echo "🖥️  Stopping MCP server (PID: $MCP_PID)..."
  kill $MCP_PID 2>/dev/null || true
  rm -f .mcp-server.pid
fi

# Also kill any lingering processes
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "tsx watch" 2>/dev/null || true

# Stop Docker services
echo "🐳 Stopping Docker services..."
docker compose down

# Clean up any orphaned containers from old docker-compose files
echo "🧹 Cleaning up orphaned containers..."
docker compose down --remove-orphans 2>/dev/null || true

# Remove specific containers if they still exist (from old setup)
for container in cloudflared mcp-prompts-cloudflared-1 mcp-prompts-cloudflared-dev-1; do
  if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "   Removing orphaned container: $container"
    docker rm -f "$container" 2>/dev/null || true
  fi
done

echo ""
echo "✅ Environment stopped"

