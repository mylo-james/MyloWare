# Local Development Setup

This guide helps you set up a complete local development environment with n8n, PostgreSQL, and the MCP server.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ installed
- npm installed

## Quick Start

### 1. Environment Setup

Create a `.env` file in the project root:

```bash
# Copy from .env.example if it exists, or create new:
cat > .env << 'EOF'
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mcp_prompts
OPERATIONS_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mcp_prompts

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Server
SERVER_PORT=3456
SERVER_HOST=0.0.0.0
NODE_ENV=development

# n8n
N8N_WEBHOOK_BASE=https://n8n.mjames.dev
EOF
```

### 2. Start All Services

```bash
# Start PostgreSQL databases and n8n
docker compose -f docker-compose.dev.yml up -d

# Wait for databases to be ready (about 10 seconds)
sleep 10

# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Start the MCP server in development mode
npm run dev

# Cloudflare tunnel (exposes https://mcp-vector.mjames.dev and https://n8n.mjames.dev)
# This runs automatically via docker-compose.dev.yml; verify with:
docker compose -f docker-compose.dev.yml logs -f cloudflared
```

### 3. Verify Services

Check that all services are running:

```bash
# Check Docker services
docker compose -f docker-compose.dev.yml ps

# Should show:
# - n8n-postgres (port 5433)
# - n8n (port 5678)
# - mcp-postgres (port 5432)

# Test MCP server health
curl http://localhost:3456/health

# Should return:
# {"status":"ok","timestamp":"...","checks":{...}}
```

### 4. Access n8n

1. Open browser to https://n8n.mjames.dev
2. The Cloudflare tunnel will prompt for auth if configured; otherwise you'll reach the n8n UI.
3. Create an account (first time only - stored in the n8n Postgres container)
4. You're ready to import workflows!

## Importing Workflows

### Method 1: Import via UI

1. In n8n, click **Workflows** > **Import from File**
2. Navigate to `workflows/` directory
3. Import these workflows:
   - `chat.workflow.json` - Main Telegram chat workflow
   - `AISMR.workflow.json` - ASMR video generation
   - `screen-writer.workflow.json` - Screenplay generation

### Method 2: Import via CLI (when n8n is running)

```bash
# From inside the n8n container
docker compose -f docker-compose.dev.yml exec n8n sh

# Then import
n8n import:workflow --input=/workflows/chat.workflow.json
n8n import:workflow --input=/workflows/AISMR.workflow.json
n8n import:workflow --input=/workflows/screen-writer.workflow.json
```

## Configuring Workflows

After importing, you need to configure credentials:

### 1. Telegram Credentials

1. In n8n, go to **Credentials** > **Add Credential**
2. Search for "Telegram"
3. Add your bot token (same as `TELEGRAM_BOT_TOKEN` in `.env`)
4. Save as "Telegram account"

### 2. OpenAI Credentials

1. **Credentials** > **Add Credential**
2. Search for "OpenAI"
3. Add your API key (same as `OPENAI_API_KEY`)
4. Save as "OpenAI"

### 3. MCP Server Connection

The workflows use HTTP Request nodes to connect to your MCP server.

**Update the base URL in workflows:**
1. Open **chat.workflow.json** workflow
2. Find nodes like "Store User Turn"
3. Update URL from `https://mcp-vector.mjames.dev` to `http://host.docker.internal:3456`
4. Repeat for all HTTP Request nodes

## Testing the Full Flow

### 1. Start Your Bot

Message your Telegram bot to test the flow:

```
@YourBot Hey, make an ASMR video about puppies
```

### 2. Watch the Flow

1. In n8n, open the **chat** workflow
2. You'll see executions appear in real-time
3. Click an execution to see the flow diagram



```bash
# Create a workflow run that requires approval
curl -X POST http://localhost:3456/api/workflow-runs \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "aismr",
    "sessionId": "test-session-123",
    "input": {
      "telegramChatId": "YOUR_CHAT_ID",
      "userInput": "test idea"
    }
  }'

# Request approval
  -H "Content-Type: application/json" \
  -d '{
    "workflowRunId": "WORKFLOW_RUN_ID_FROM_ABOVE",
    "stage": "idea_generation",
    "content": {
      "ideas": ["idea 1", "idea 2"]
    }
  }'
```

You should receive a Telegram message in your chat!

### 4. Test Approval

Approve via API:

```bash
# Get pending approvals

# Approve one
  -H "Content-Type: application/json" \
  -d '{
    "reviewedBy": "test-user",
    "selectedItem": {"idea": "idea 1"},
    "feedback": "Looks good!"
  }'
```

## Development Workflow

### Making Changes

```bash
# 1. Make code changes

# 2. Server auto-restarts (using npm run dev)

# 3. Test via Telegram or API

# 4. Check logs
docker compose -f docker-compose.dev.yml logs -f n8n
# or
docker compose -f docker-compose.dev.yml logs -f mcp-postgres
```

### Database Access

```bash
# Connect to MCP database
docker compose -f docker-compose.dev.yml exec mcp-postgres \
  psql -U postgres -d mcp_prompts

# Connect to n8n database
docker compose -f docker-compose.dev.yml exec n8n-postgres \
  psql -U n8n -d n8n

# View workflow runs
psql $DATABASE_URL -c "SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 5;"

```

### Debugging n8n Workflows

1. **Enable Debug Mode** in n8n settings
2. **Add Stop and Error nodes** to catch issues
3. **Use Execute Workflow nodes** to test sub-workflows
4. **Check execution logs** in n8n UI

## Stopping Services

```bash
# Stop all services but keep data
docker compose -f docker-compose.dev.yml stop

# Stop and remove containers (keeps volumes)
docker compose -f docker-compose.dev.yml down

# Nuclear option: remove everything including data
docker compose -f docker-compose.dev.yml down -v
```

## Troubleshooting

### n8n can't connect to MCP server

**Problem:** HTTP requests from n8n fail with connection refused

**Solution:** 
- Use `http://host.docker.internal:3456` not `http://localhost:3456`
- Ensure MCP server is running on host
- Check firewall isn't blocking Docker

### Telegram bot not responding

**Problem:** Workflow triggers but no response

**Solutions:**
1. Check bot token is correct in n8n credentials
2. Verify bot is not already running elsewhere
3. Check webhook is registered: `/getWebhookInfo` via BotFather
4. Delete and re-add Telegram Trigger node

### Database migration errors

**Problem:** Migration fails or tables missing

**Solutions:**
```bash
# Drop and recreate database
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
sleep 10
npm run db:migrate
npm run db:operations:migrate
```

### n8n executions failing

**Problem:** Workflows execute but nodes fail

**Solutions:**
1. Check credentials are configured
2. Update API URLs to use `host.docker.internal`
3. Check n8n logs: `docker compose -f docker-compose.dev.yml logs n8n`
4. Verify environment variables in docker-compose

## Tips

### Hot Reload

The MCP server uses `tsx watch` for hot reload:
- Changes to TypeScript files auto-reload the server
- No need to restart Docker

### View Metrics

```bash
# Prometheus metrics
curl http://localhost:3456/metrics

# Health check with database status
curl http://localhost:3456/health | jq
```

### Test Rate Limiting

```bash
# Send 110 requests
for i in {1..110}; do
  curl -s http://localhost:3456/health > /dev/null
  echo "Request $i"
done

# After ~100 requests, you should get 429 Too Many Requests
```

### Export Workflows

After making changes in n8n UI:

```bash
# From n8n container
docker compose -f docker-compose.dev.yml exec n8n sh

# Export updated workflow
n8n export:workflow --id=WORKFLOW_ID --output=/workflows/chat.workflow.json
```

Then commit the updated workflow file.

## Architecture

```
┌─────────────────┐
│   Telegram      │
│    (User)       │
└────────┬────────┘
         │
         v
┌─────────────────┐      ┌──────────────────┐
│   n8n           │─────>│  MCP Server      │
│   :5678         │      │  :3456           │
│                 │<─────│                  │
│ - AISMR workflow│      │ - Prompt storage │
│ - Webhooks      │      │ - Vector search  │
└────────┬────────┘      └────────┬─────────┘
         │                        │
         v                        v
┌─────────────────┐      ┌──────────────────┐
│ n8n PostgreSQL  │      │  MCP PostgreSQL  │
│ :5433           │      │  :5432           │
│                 │      │                  │
│ - Workflows     │      │ - Prompts        │
│ - Executions    │      │ - Workflow runs  │
└─────────────────┘      └──────────────────┘
```

## Next Steps

Once you have local development working:

2. **Iterate on workflow design** in n8n UI
3. **Add workflow tests** (see `workflows/README.md`)
4. **Monitor metrics** at `/metrics` endpoint
5. **Export and commit** workflow changes

## Production Deployment

This setup is for **local development only**. For production:

- Use managed PostgreSQL (e.g., Supabase, AWS RDS)
- Deploy n8n to n8n Cloud or self-hosted with proper security
- Use environment variables for secrets
- Enable HTTPS/TLS
- Set up monitoring and alerting
- Use the existing CI/CD pipeline
