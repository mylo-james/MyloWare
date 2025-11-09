#!/bin/bash

# Deployment Verification Script
# Run this after starting services to verify everything works

echo "🔍 MCP Deployment Verification"
echo "==============================="
echo ""

cd "$(dirname "$0")/../.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FAILED=0

# Check .env exists
echo -n "Checking .env file... "
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "  Error: .env file not found"
    FAILED=1
fi

# Check Docker containers
echo ""
echo "📦 Checking Docker containers:"
echo "-----------------------------"

check_container() {
    NAME=$1
    if docker compose ps | grep -q "$NAME.*Up"; then
        echo -e "${GREEN}✓${NC} $NAME is running"
        return 0
    else
        echo -e "${RED}✗${NC} $NAME is NOT running"
        FAILED=1
        return 1
    fi
}

check_container "postgres"
check_container "mcp-server"
check_container "n8n"
check_container "cloudflared"

# Check health endpoints
echo ""
echo "🏥 Checking health endpoints:"
echo "-----------------------------"

check_health() {
    NAME=$1
    URL=$2
    echo -n "Testing $NAME... "
    if curl -sf "$URL" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Healthy${NC}"
        return 0
    else
        echo -e "${RED}✗ Not responding${NC}"
        FAILED=1
        return 1
    fi
}

check_health "postgres" "http://localhost:5432" || true  # Postgres doesn't have HTTP
check_health "mcp-server (local)" "http://localhost:3456/health"
check_health "n8n (local)" "http://localhost:5678/healthz"

echo ""
echo "🌐 Checking external endpoints:"
echo "--------------------------------"
check_health "MCP (Cloudflare)" "https://mcp-vector.mjames.dev/health"
check_health "n8n (Cloudflare)" "https://n8n.mjames.dev/healthz"

# Check MCP authentication
echo ""
echo "🔐 Checking MCP authentication:"
echo "--------------------------------"

if [ -f ".env" ]; then
    source .env
    echo -n "Testing MCP tools/list... "
    
    RESPONSE=$(curl -s -X POST http://localhost:3456/mcp \
        -H "Content-Type: application/json" \
        -H "x-api-key: $MCP_AUTH_KEY" \
        -H "Accept: application/json, text/event-stream" \
        -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' 2>&1)
    
    if echo "$RESPONSE" | grep -q '"tools"'; then
        echo -e "${GREEN}✓ Authentication working${NC}"
        TOOL_COUNT=$(echo "$RESPONSE" | grep -o '"name"' | wc -l | tr -d ' ')
        echo "  Found $TOOL_COUNT MCP tools"
    else
        echo -e "${RED}✗ Authentication failed${NC}"
        echo "  Response: $RESPONSE"
        FAILED=1
    fi
fi

# Check logs for errors
echo ""
echo "📋 Checking recent logs for errors:"
echo "------------------------------------"

ERROR_COUNT=$(docker compose logs --tail=50 2>&1 | grep -i "error" | grep -v "deprecation" | wc -l | tr -d ' ')
if [ "$ERROR_COUNT" -eq "0" ]; then
    echo -e "${GREEN}✓${NC} No recent errors in logs"
else
    echo -e "${YELLOW}⚠${NC} Found $ERROR_COUNT error messages in recent logs"
    echo "  Run: docker compose logs | grep -i error"
fi

# Check ports
echo ""
echo "🔌 Checking port bindings:"
echo "--------------------------"

check_port() {
    PORT=$1
    NAME=$2
    if lsof -i :$PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Port $PORT ($NAME) is in use"
    else
        echo -e "${RED}✗${NC} Port $PORT ($NAME) is NOT in use"
        FAILED=1
    fi
}

check_port 3456 "MCP Server"
check_port 5678 "n8n"
check_port 5432 "PostgreSQL"

# Final summary
echo ""
echo "==============================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
    echo ""
    echo "🎉 Your MCP server is fully operational!"
    echo ""
    echo "Next steps:"
    echo "  1. Go to https://n8n.mjames.dev"
    echo "  2. Update MCP credential to send header 'x-api-key: <key>'"
    echo "  3. Test your workflows"
    exit 0
else
    echo -e "${RED}❌ SOME CHECKS FAILED${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check logs: docker compose logs -f"
    echo "  2. Verify .env file has all required values"
    echo "  3. Try restarting: docker compose restart"
    echo "  4. See DEPLOYMENT_FIX.md for detailed troubleshooting"
    exit 1
fi


