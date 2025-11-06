#!/bin/bash
set -e

# Setup N8N with MCP Integration
# This script imports workflows and sets up credentials

echo "🚀 N8N + MCP Setup Script"
echo "=========================="
echo ""

# Load environment variables
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "   Please create .env file first"
    exit 1
fi

source .env

# Note: For service verification, use: ./scripts/verify-deployment.sh

N8N_URL="http://localhost:${N8N_PORT:-5678}"

echo "📋 N8N CREDENTIAL SETUP INSTRUCTIONS:"
echo "=========================="
echo ""
echo "1. Ensure services are running:"
echo "   docker compose --profile prod up -d"
echo ""
echo "2. Run verification (optional):"
echo "   ./scripts/verify-deployment.sh"
echo ""
echo "3. Open n8n in your browser:"
echo "   $N8N_URL"
echo ""
echo "4. Login with:"
echo "   Email: ${N8N_USER}"
echo "   Password: ${N8N_PASSWORD}"
echo ""
echo "5. Create MCP HTTP Header Auth Credential:"
echo "   - Go to: Credentials > New Credential"
echo "   - Type: HTTP Header Auth"
echo "   - Name: Mylo MCP"
echo "   - Header Name: x-api-key"
echo "   - Header Value: ${MCP_AUTH_KEY}"
echo "   - Save"
echo ""
echo "6. Create OpenAI Credential:"
echo "   - Go to: Credentials > New Credential"
echo "   - Type: OpenAI API"
echo "   - Name: OpenAi account"
echo "   - API Key: ${OPENAI_API_KEY}"
echo "   - Save"
echo ""
echo "7. Create Telegram Credential (if using Telegram bot):"
echo "   - Go to: Credentials > New Credential"
echo "   - Type: Telegram API"
echo "   - Name: Telegram account"
echo "   - Access Token: ${TELEGRAM_BOT_TOKEN}"
echo "   - Save"
echo ""
echo "8. Import the agent workflow:"
echo "   - Go to: Workflows > Import from File"
echo "   - Select: workflows/agent.workflow.json"
echo "   - After import, update the credential references to use the ones you just created"
echo ""
echo "9. Test MCP connection in the workflow:"
echo "   - Open the 'MCP Client' node"
echo "   - Verify endpoint URL: https://mcp-vector.mjames.dev/mcp"
echo "   - Select credential: Mylo MCP"
echo "   - Click 'Test connection'"
echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 NOTE: Due to n8n's credential encryption, we cannot auto-import credentials."
echo "   You must create them manually through the n8n UI."
echo ""
echo "🔧 TROUBLESHOOTING:"
echo "   - If MCP connection fails, check the header name is 'x-api-key' (not 'Authorization')"
echo "   - Check cloudflare tunnel logs: docker compose logs cloudflared"
echo "   - Check MCP server logs: docker compose logs mcp-server"
echo ""

