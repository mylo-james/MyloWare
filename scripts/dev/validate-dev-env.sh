#!/bin/bash
# Validate Development Environment
# Checks that all services and data are properly configured

echo "🔍 Validating Development Environment"
echo "======================================"
echo ""

success_count=0
failure_count=0
warning_count=0

check_pass() {
    echo "✅ $1"
    success_count=$((success_count + 1))
}

check_fail() {
    echo "❌ $1"
    failure_count=$((failure_count + 1))
}

check_warn() {
    echo "⚠️  $1"
    warning_count=$((warning_count + 1))
}

# Check 1: Docker is running
echo "1️⃣  Checking Docker..."
if docker ps &>/dev/null; then
    check_pass "Docker is running"
else
    check_fail "Docker is not running"
    echo ""
    echo "Please start Docker and try again"
    exit 1
fi

# Check 2: Required containers are running
echo ""
echo "2️⃣  Checking containers..."
if docker ps | grep -q mcp-postgres; then
    check_pass "PostgreSQL container is running"
else
    check_fail "PostgreSQL container is not running"
fi

if docker ps | grep -q n8n; then
    check_pass "n8n container is running"
else
    check_fail "n8n container is not running"
fi

# Check 3: PostgreSQL is healthy
echo ""
echo "3️⃣  Checking PostgreSQL health..."
if docker exec mcp-postgres pg_isready -U mylo -d memories &>/dev/null; then
    check_pass "PostgreSQL is healthy"
else
    check_fail "PostgreSQL is not healthy"
fi

# Check 4: Database tables exist
echo ""
echo "4️⃣  Checking database schema..."
TABLES=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "0")
if [ "$TABLES" -ge 11 ]; then
    check_pass "Database has $TABLES tables"
else
    check_fail "Database has only $TABLES tables (expected 11+)"
fi

# Check 5: Database is seeded
echo ""
echo "5️⃣  Checking database seed data..."

PERSONA_COUNT=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM personas;" 2>/dev/null || echo "0")
if [ "$PERSONA_COUNT" -eq 6 ]; then
    check_pass "Personas: $PERSONA_COUNT/6"
elif [ "$PERSONA_COUNT" -gt 0 ]; then
    check_warn "Personas: $PERSONA_COUNT/6 (expected 6)"
else
    check_fail "Personas: $PERSONA_COUNT/6 (table empty)"
fi

PROJECT_COUNT=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM projects;" 2>/dev/null || echo "0")
if [ "$PROJECT_COUNT" -ge 4 ]; then
    check_pass "Projects: $PROJECT_COUNT/4"
elif [ "$PROJECT_COUNT" -gt 0 ]; then
    check_warn "Projects: $PROJECT_COUNT/4 (expected 4+)"
else
    check_fail "Projects: $PROJECT_COUNT/4 (table empty)"
fi

WEBHOOK_COUNT=$(docker exec mcp-postgres psql -U mylo -d memories -tAc "SELECT COUNT(*) FROM agent_webhooks;" 2>/dev/null || echo "0")
if [ "$WEBHOOK_COUNT" -eq 6 ]; then
    check_pass "Agent webhooks: $WEBHOOK_COUNT/6"
elif [ "$WEBHOOK_COUNT" -gt 0 ]; then
    check_warn "Agent webhooks: $WEBHOOK_COUNT/6"
else
    check_fail "Agent webhooks: $WEBHOOK_COUNT/6 (table empty)"
fi

# Check 6: MCP Server is running
echo ""
echo "6️⃣  Checking MCP Server..."
if curl -s -f http://localhost:3456/health &>/dev/null; then
    check_pass "MCP Server is healthy (localhost:3456)"
    
    # Check MCP tools
    HEALTH_JSON=$(curl -s http://localhost:3456/health 2>/dev/null || echo "{}")
    if echo "$HEALTH_JSON" | grep -q "\"database\":\"ok\""; then
        check_pass "MCP Server database connection is OK"
    else
        check_warn "MCP Server database connection status unknown"
    fi
    
    if echo "$HEALTH_JSON" | grep -q "\"openai\":\"ok\""; then
        check_pass "MCP Server OpenAI connection is OK"
    else
        check_warn "MCP Server OpenAI connection status unknown"
    fi
else
    check_fail "MCP Server is not responding on localhost:3456"
fi

# Check 7: n8n is accessible
echo ""
echo "7️⃣  Checking n8n..."
if curl -s -f http://localhost:5678 &>/dev/null; then
    check_pass "n8n is accessible (localhost:5678)"
else
    check_fail "n8n is not accessible on localhost:5678"
fi

# Check 8: Environment variables
echo ""
echo "8️⃣  Checking environment..."
if [ -f ".env" ]; then
    check_pass ".env file exists"
    
    if grep -q "OPENAI_API_KEY=sk-" .env 2>/dev/null; then
        check_pass "OpenAI API key is configured"
    else
        check_warn "OpenAI API key may not be configured"
    fi
    
    if grep -q "MCP_AUTH_KEY=" .env 2>/dev/null; then
        check_pass "MCP auth key is configured"
    else
        check_warn "MCP auth key may not be configured"
    fi
else
    check_fail ".env file does not exist"
fi

# Summary
echo ""
echo "======================================"
echo "📊 Validation Summary"
echo "======================================"
echo "✅ Passed: $success_count"
if [ $warning_count -gt 0 ]; then
    echo "⚠️  Warnings: $warning_count"
fi
if [ $failure_count -gt 0 ]; then
    echo "❌ Failed: $failure_count"
fi
echo ""

if [ $failure_count -eq 0 ]; then
    echo "🎉 Development environment is properly configured!"
    echo ""
    echo "🚀 Quick Start:"
    echo "   npm run dev              # Start with hot reload"
    echo "   ./start-dev.sh           # Full environment startup"
    echo ""
    echo "📝 Useful Commands:"
    echo "   curl http://localhost:3456/health    # Check MCP server"
    echo "   open http://localhost:5678           # Open n8n"
    echo "   npm run test:unit                    # Run tests"
    echo ""
    exit 0
else
    echo "❌ Please fix the issues above before continuing"
    echo ""
    echo "💡 Quick fixes:"
    echo "   ./start-dev.sh           # Start environment"
    echo "   npm run db:bootstrap -- --seed   # Initialize database"
    echo ""
    exit 1
fi

