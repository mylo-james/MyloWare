#!/bin/bash
set -e

echo "🚀 Setting up MCP Prompts local development environment..."

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "❌ Docker is required but not installed. Aborting." >&2; exit 1; }
command -v docker compose >/dev/null 2>&1 || { echo "❌ Docker Compose is required but not installed. Aborting." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }

echo "✅ Prerequisites check passed"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << 'EOF'
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mcp_prompts
OPERATIONS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mcp_prompts

# OpenAI (REQUIRED - get from https://platform.openai.com/api-keys)
OPENAI_API_KEY=sk-proj-...

# Telegram (REQUIRED - get from @BotFather)
TELEGRAM_BOT_TOKEN=

# Server
SERVER_PORT=3456
SERVER_HOST=0.0.0.0
NODE_ENV=development

# n8n
N8N_WEBHOOK_BASE=https://n8n.mjames.dev
N8N_BASE_URL=https://n8n.mjames.dev/
EOF
    echo "⚠️  Please edit .env and add your OPENAI_API_KEY and TELEGRAM_BOT_TOKEN"
    echo "   Then run this script again."
    exit 0
fi

# Check required env vars
source .env
if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "sk-proj-..." ]; then
    echo "❌ OPENAI_API_KEY not set in .env"
    exit 1
fi

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "⚠️  TELEGRAM_BOT_TOKEN not set - Telegram features won't work"
    echo "   Get a token from @BotFather and add to .env"
fi

echo "✅ Environment variables configured"

# Start Docker services
echo "🐳 Starting Docker services..."
docker compose -f docker-compose.dev.yml up -d

# Wait for databases
echo "⏳ Waiting for databases to be ready..."
sleep 15

# Check database health
echo "🏥 Checking database health..."
docker compose -f docker-compose.dev.yml exec -T mcp-postgres pg_isready -U postgres || {
    echo "❌ MCP database not ready"
    exit 1
}
docker compose -f docker-compose.dev.yml exec -T n8n-postgres pg_isready -U n8n || {
    echo "❌ n8n database not ready"
    exit 1
}

echo "✅ Databases are healthy"

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Run migrations
echo "🔧 Running database migrations..."
npm run db:migrate

echo "✅ Database migrations complete"

# Print success message
echo ""
echo "✨ Setup complete! Your local development environment is ready."
echo ""
echo "Next steps:"
echo "  1. Start the MCP server:    npm run dev"
echo "  2. Open n8n:                https://n8n.mjames.dev"
echo "  3. Import workflows from:   ./workflows/"
echo "  4. Configure credentials in n8n UI"
echo ""
echo "Useful commands:"
echo "  • View logs:                docker compose -f docker-compose.dev.yml logs -f"
echo "  • Stop services:            docker compose -f docker-compose.dev.yml stop"
echo "  • Restart services:         docker compose -f docker-compose.dev.yml restart"
echo "  • Clean everything:         docker compose -f docker-compose.dev.yml down -v"
echo ""
echo "📚 Full documentation: docs/LOCAL-DEVELOPMENT.md"
echo ""
