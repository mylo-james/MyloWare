#!/bin/bash

# MCP Prompts Setup and Start Script
# This script will help you set up and start the MCP server properly

set -e

echo "🚀 MCP Prompts Setup and Start Script"
echo "======================================"
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml not found"
    echo "Please run this script from the mcp-prompts directory"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found"
    echo ""
    echo "Please create .env file with the following content:"
    echo ""
    echo "DB_PASSWORD=your_secure_password"
    echo "OPENAI_API_KEY=sk-your-key"
    echo "MCP_AUTH_KEY=\$(openssl rand -hex 32)"
    echo "SERVER_PORT=3456"
    echo "N8N_USER=admin"
    echo "N8N_PASSWORD=your_secure_password"
    echo "N8N_PORT=5678"
    echo "MCP_SERVER_URL=http://mcp-server:3456/mcp"
    echo "DATABASE_URL=postgresql://mylo:\${DB_PASSWORD}@postgres:5432/memories"
    echo "LOG_LEVEL=info"
    echo "ALLOWED_ORIGINS=*"
    echo ""
    echo "See DEPLOYMENT_FIX.md for full instructions"
    exit 1
fi

echo "✅ Found .env file"
echo ""

# Clean up old containers
echo "🧹 Cleaning up old containers..."
docker rm -f mcp-prompts-cloudflared-1 mcp-prompts-n8n-1 mcp-prompts-mcp-postgres-1 mcp-prompts-n8n-postgres-1 2>/dev/null || true
docker rm -f mcp-server mcp-postgres n8n cloudflared 2>/dev/null || true
echo "✅ Old containers removed"
echo ""

# Build the application
echo "🔨 Building MCP server..."
npm run build
echo "✅ Build complete"
echo ""

# Build Docker images
echo "🐳 Building Docker images..."
docker compose build
echo "✅ Docker images built"
echo ""

# Start services
echo "🚀 Starting services..."
docker compose up -d
echo "✅ Services started"
echo ""

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check status
echo ""
echo "📊 Service Status:"
echo "=================="
docker compose ps
echo ""

# Test health endpoints
echo "🏥 Health Checks:"
echo "================="

echo -n "Testing postgres... "
if docker compose exec -T postgres pg_isready -U mylo -d memories > /dev/null 2>&1; then
    echo "✅ Healthy"
else
    echo "❌ Not ready"
fi

echo -n "Testing mcp-server... "
if curl -s -f http://localhost:3456/health > /dev/null 2>&1; then
    echo "✅ Healthy"
else
    echo "❌ Not responding"
fi

echo -n "Testing n8n... "
if curl -s -f http://localhost:5678/healthz > /dev/null 2>&1; then
    echo "✅ Healthy"
else
    echo "❌ Not responding"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Check logs: docker compose logs -f"
echo "2. Test MCP endpoint: curl http://localhost:3456/health"
echo "3. Test through Cloudflare: curl https://mcp-vector.mjames.dev/health"
echo "4. Update n8n credential to send header 'x-api-key: <your-mcp-auth-key>'"
echo ""
echo "For troubleshooting, see docs/TROUBLESHOOTING.md"
