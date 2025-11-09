# Configuration and Environment

**Audience:** Operators and developers  
**Outcome:** Understand all environment variables and configuration options

---

## Overview

MyloWare configuration is managed via environment variables and JSON files.

**Configuration sources:**
- `.env` files - Runtime configuration
- `data/personas/*.json` - Agent configuration
- `data/projects/*.json` - Project configuration

---

## Environment Variables

### Required

#### OPENAI_API_KEY
OpenAI API key for embeddings and summarization.

```bash
OPENAI_API_KEY=sk-your-key-here
```

**Used for:**
- Text embeddings (text-embedding-3-small)
- Memory summarization (gpt-4o-mini)

---

### Database

#### DATABASE_URL
PostgreSQL connection string.

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/mcp_v2
```

**Format:** `postgresql://[user[:password]@][host][:port][/dbname]`

#### POSTGRES_HOST
Database host (alternative to DATABASE_URL).

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=mcp_v2
POSTGRES_USER=mcp_user
POSTGRES_PASSWORD=secure-password
```

---

### Server

#### SERVER_PORT
HTTP server port.

```bash
SERVER_PORT=3456
```

**Default:** 3456

#### SERVER_HOST
Bind address.

```bash
SERVER_HOST=0.0.0.0
```

**Default:** 0.0.0.0 (all interfaces)

#### LOG_LEVEL
Logging verbosity.

```bash
LOG_LEVEL=info
```

**Options:** debug | info | warn | error  
**Default:** info

---

### MCP

#### MCP_AUTH_KEY
API key for MCP endpoint authentication.

```bash
MCP_AUTH_KEY=mylo-mcp-bot
```

**Used in:** `X-API-Key` header  
**Default:** None (auth disabled if not set)

---

### n8n Integration

#### N8N_BASE_URL
n8n instance URL for API calls.

```bash
N8N_BASE_URL=https://n8n.yourdomain.com
```

**Default:** http://n8n:5678

#### N8N_API_KEY
n8n API key for workflow execution.

```bash
N8N_API_KEY=your-n8n-api-key
```

**Required for:** Workflow imports, execution monitoring

#### N8N_WEBHOOK_URL
Public base URL for webhook invocations.

```bash
N8N_WEBHOOK_URL=https://n8n.yourdomain.com
```

**Used by:** `handoff_to_agent` tool  
**Default:** Falls back to `N8N_BASE_URL`

#### N8N_WEBHOOK_AUTH_TOKEN
Shared secret for webhook authentication.

```bash
N8N_WEBHOOK_AUTH_TOKEN=your-webhook-secret
```

**Optional:** Only if webhooks require auth

---

### Telegram (Optional)

#### TELEGRAM_BOT_TOKEN
Telegram bot token.

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

**Required for:** Telegram integration

#### TELEGRAM_USER_ID
Authorized user ID.

```bash
TELEGRAM_USER_ID=123456789
```

**Used for:** Access control

---

### Security

#### ALLOWED_CORS_ORIGINS
Comma-separated list of CORS origins allowed to call the MCP endpoint.

```bash
ALLOWED_CORS_ORIGINS=https://n8n.yourdomain.com,https://studio.yourdomain.com
```

**Default:** (empty) — fail-closed, rejects all cross-origin requests.  
**Tip:** Always set explicit origins in staging/production.

#### ALLOWED_HOST_KEYS
Comma-separated list of hostnames/IPs allowed to connect to the MCP transport (DNS rebinding protection).

```bash
ALLOWED_HOST_KEYS=127.0.0.1,localhost,mcp-server,mcp.yourdomain.com
```

**Default:** 127.0.0.1, localhost, mcp-server  
**Note:** Port variants are added automatically using the configured server port.

#### DEBUG_AUTH
Enables verbose authentication logging (hashes, headers) for debugging. **Never enable in production.**

```bash
DEBUG_AUTH=false
```

**Default:** false

#### RATE_LIMIT_MAX
Maximum requests per time window.

```bash
RATE_LIMIT_MAX=100
```

**Default:** 100

#### RATE_LIMIT_TIME_WINDOW
Rate limit time window.

```bash
RATE_LIMIT_TIME_WINDOW=1 minute
```

**Default:** 1 minute

### Session

#### SESSION_TTL_MS
Time-to-live (in milliseconds) for MCP session transports before automatic cleanup.

```bash
SESSION_TTL_MS=3600000
```

**Default:** 3600000 (1 hour)

#### MAX_SESSIONS_PER_USER
Maximum number of active sessions to retain (LRU eviction beyond this threshold).

```bash
MAX_SESSIONS_PER_USER=10
```

**Default:** 10

---

## Environment Files

### .env.example
Template with all variables and descriptions.

### .env
Active environment (gitignored).

```bash
cp .env.example .env
```

### .env.dev
Development-specific overrides.

### .env.test
Test-specific configuration.

### .env.prod
Production configuration.

---

## Multi-Environment Setup

### Switch Environments

```bash
# Use development
npm run env:use-dev

# Use test
npm run env:use-test

# Use production
npm run env:use-prod
```

This symlinks `.env` to the appropriate file.

### Environment-Specific Commands

```bash
# Start dev environment
npm run env:dev start

# Start test environment
npm run env:test start

# Start production
npm run env:prod start
```

---

## Configuration Files

### Personas
**Location:** `data/personas/*.json`  
**Seed:** `npm run migrate:personas`

**Fields:**
- `name` - Unique identifier
- `title` - Display name
- `systemPrompt` - Core identity
- `allowedTools` - MCP tools
- `guardrails` - Constraints

### Projects
**Location:** `data/projects/*.json`  
**Seed:** `npm run migrate:projects`

**Fields:**
- `slug` - Unique identifier
- `workflow` - Agent pipeline
- `optionalSteps` - Skippable agents
- `specs` - Requirements
- `guardrails` - Quality rules

### Workflows
**Location:** `workflows/*.workflow.json`  
**Import:** `npm run import:workflows`

**Key workflow:**
- `myloware-agent.workflow.json` - Universal workflow

---

## Validation

### Check Configuration

```bash
# Verify environment
npm run dev:validate

# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Check OpenAI API
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Check n8n connection
curl $N8N_BASE_URL/healthz
```

### Validate Secrets

```bash
# Check required vars are set
if [ -z "$OPENAI_API_KEY" ]; then
  echo "Error: OPENAI_API_KEY not set"
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set"
fi
```

---

## Best Practices

1. **Never commit .env** - Always gitignored
2. **Use strong secrets** - Generate with `openssl rand -hex 32`
3. **Separate environments** - Different keys for dev/test/prod
4. **Document variables** - Keep .env.example updated
5. **Validate on startup** - Fail fast if config invalid

---

## Further Reading

- [Deployment Guide](../05-operations/deployment.md) - Production setup
- [Development Guide](../07-contributing/dev-guide.md) - Local development
- [Troubleshooting](../05-operations/troubleshooting.md) - Common issues

