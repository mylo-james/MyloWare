# Setup Guide

Step-by-step guide for setting up and running MCP Prompts V2.

---

## Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for development)
- OpenAI API key
- PostgreSQL 15+ with pgvector extension (or use Docker)

---

## Step 1: Environment Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/mcp-prompts
   cd mcp-prompts/v2
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Edit `.env` with your credentials:**
   ```bash
   # Required
   DATABASE_URL=postgresql://user:password@localhost:5432/mcp_prompts
   OPENAI_API_KEY=sk-your-key-here

   # Optional (for production)
   MCP_AUTH_KEY=your-secret-key-here
   N8N_BASE_URL=http://localhost:5678
   N8N_API_KEY=optional-n8n-api-key
   ```

---

## Step 2: Database Initialization

1. **Start PostgreSQL:**
   ```bash
   docker compose up postgres -d
   ```

2. **Wait for database to be ready** (about 10 seconds)

3. **Run migrations:**
   ```bash
   npm run db:push
   ```

   This creates all tables, indices, and extensions (pgvector).

4. **Verify database:**
   ```bash
   npm run db:status
   ```

---

## Step 3: n8n Configuration

1. **Start n8n:**
   ```bash
   docker compose up n8n -d
   ```

2. **Access n8n UI:**
   - Open `http://localhost:5678`
   - Create admin account (first time only)

3. **Configure Credentials:**
   
   Add these credentials in n8n:
   
   - **Telegram API** (for message trigger)
     - Name: "Telegram account"
     - Bot Token: Your Telegram bot token
   
   - **OpenAI API** (for AI agent)
     - Name: "OpenAi account"
     - API Key: Your OpenAI API key
   
   - **MCP Header Auth** (for calling MCP server)
     - Name: "Mylo MCP"
     - Header Name: `X-MCP-Auth-Key`
     - Header Value: Value from `MCP_AUTH_KEY` env var (if set)
   
   - **Kie.ai Bearer Auth** (for video generation)
     - Name: "Bearer Auth account"
     - Token: Your Kie.ai API token
   
   - **Shotstack Header Auth** (for video editing)
     - Name: "shotstack"
     - Header Name: `x-api-key`
     - Header Value: Your Shotstack API key

4. **Import Workflows:**
   ```bash
   npm run import:workflows
   ```
   
   This imports:
   - `agent.workflow.json` (main agent workflow)
   - `edit-aismr.workflow.json` (video editing)
   - `generate-video.workflow.json` (video generation)
   
   **Note:** Copy the workflow IDs from the output and update `agent.workflow.json` toolWorkflow nodes.

5. **Update Agent Workflow IDs:**
   - Open `v2/workflows/agent.workflow.json`
   - Find `"Call 'Edit_AISMR'"` node (around line 192)
   - Update `workflowId.value` with the imported Edit_AISMR workflow ID
   - Repeat for Generate Video workflow if present

6. **Activate Agent Workflow:**
   - In n8n UI, open the agent workflow
   - Click "Active" toggle to activate
   - Test with pinned data first

---

## Step 4: Start MCP Server

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm run dev
   ```

   Server starts on `http://localhost:3000`

3. **Verify health:**
   ```bash
   curl http://localhost:3000/health
   ```

   Should return:
   ```json
   {
     "status": "healthy",
     "checks": {
       "database": "ok",
       "openai": "ok"
     }
   }
   ```

---

## Step 5: Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### E2E Tests

```bash
npm run test:e2e
```

### Test MCP Client

```bash
npm run test:mcp
```

---

## Step 6: Verify End-to-End Flow

1. **Send test Telegram message:**
   - Message your Telegram bot
   - Send: "Create an AISMR video about rain"

2. **Check n8n execution:**
   - Open n8n UI → Executions
   - Verify agent workflow executed
   - Check that MCP tools were called

3. **Check MCP server logs:**
   - View console output from `npm run dev`
   - Verify tool calls logged

4. **Check database:**
   ```bash
   # Connect to Postgres
   docker compose exec postgres psql -U postgres -d mcp_prompts

   # Check workflow runs
   SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 5;

   # Check memories
   SELECT id, content, memory_type FROM memories ORDER BY created_at DESC LIMIT 5;
   ```

---

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running: `docker compose ps`
- Check DATABASE_URL format: `postgresql://user:password@host:port/database`
- Ensure pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector;`

### MCP Server Won't Start

- Check OpenAI API key is valid
- Verify DATABASE_URL is correct
- Check logs: `npm run dev` output

### n8n Can't Connect to MCP

- Verify MCP server is running: `curl http://localhost:3000/health`
- Check MCP_AUTH_KEY matches in both .env and n8n credentials
- Verify n8n MCP Client node URL: `http://mcp-server:3000/mcp` (Docker) or `http://localhost:3000/mcp` (local)

### Workflow Import Fails

- Verify n8n is running and accessible
- Check N8N_BASE_URL in .env
- Try importing manually via n8n UI: Workflows → Import from File

### TypeScript Build Errors

- Run `npm run type-check` to see errors
- Ensure all dependencies installed: `npm install`
- Check Node.js version: `node --version` (should be 18+)

### ESLint Errors

- Run `npm run lint:fix` to auto-fix
- Check `eslint.config.mjs` for configuration

---

## Production Deployment

1. **Set environment variables:**
   - `MCP_AUTH_KEY` (required for security)
   - `N8N_API_KEY` (optional, for n8n API calls)
   - All database and API credentials

2. **Build:**
   ```bash
   npm run build
   ```

3. **Start:**
   ```bash
   npm start
   ```

4. **Monitor:**
   - Health: `http://your-server:3000/health`
   - Metrics: `http://your-server:3000/metrics`

---

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- Read [MCP_TOOLS.md](MCP_TOOLS.md) for tool reference
- Read [NORTH_STAR.md](../NORTH_STAR.md) for vision and examples

---

## Support

- Check logs: `npm run dev` output
- Check n8n executions: n8n UI → Executions
- Check database: Connect to Postgres and query tables
- Review documentation in `docs/` directory

