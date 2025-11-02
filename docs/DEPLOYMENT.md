# Deployment Guide

This guide covers deploying the complete HITL + RAG-driven workflow system.

## Prerequisites

- PostgreSQL database with `pgvector` extension
- Node.js 18+ and npm
- n8n instance (self-hosted or cloud)
- Environment variables configured

## Step 1: Database Setup

### 1.1 Create Databases

```sql
-- Main database for prompts and embeddings
CREATE DATABASE mcp_prompts;

-- Operations database for workflow runs and HITL
CREATE DATABASE mcp_operations;
```

### 1.2 Enable Extensions

```sql
-- In both databases
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 1.3 Run Migrations

```bash
# Main database migrations
npm run db:migrate

# Operations database migrations
npm run db:operations:migrate
```

This will create:
- `prompt_embeddings` table (with vector support)
- `workflow_runs` table (workflow state tracking)
- `hitl_approvals` table (HITL approval tracking)
- All necessary indexes

### 1.4 Verify Schema

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('prompt_embeddings', 'workflow_runs', 'hitl_approvals');
```

## Step 2: Ingest Workflow Definitions

```bash
# Ingest all prompts and workflow definitions
npm run ingest:prompts
```

This will:
- Parse all JSON files in `prompts/`
- Generate embeddings
- Store in database
- Make searchable via MCP tools

### Verify Ingestion

Check that workflows are searchable:

```bash
curl -X GET "https://mcp-vector.mjames.dev/api/prompts/search?q=workflow+definition+aismr&project=aismr" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Step 3: Environment Variables

Create `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mcp_prompts
OPERATIONS_DATABASE_URL=postgresql://user:pass@localhost:5432/mcp_operations

# Server
SERVER_PORT=3000
SERVER_HOST=0.0.0.0

# API Keys
MCP_API_KEY=your-api-key-here

# External APIs (for video generation, etc.)
VEO_API_KEY=your-veo-key
SHOTSTACK_API_KEY=your-shotstack-key
TIKTOK_API_KEY=your-tiktok-key
YOUTUBE_API_KEY=your-youtube-key
INSTAGRAM_API_KEY=your-instagram-key

# Notifications (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
EMAIL_SMTP_HOST=smtp.example.com
EMAIL_SMTP_PORT=587
EMAIL_FROM=noreply@example.com

# CORS
HTTP_ALLOWED_ORIGINS=https://your-n8n-instance.com
HTTP_ALLOWED_HOSTS=mcp-vector.mjames.dev
```

## Step 4: Build and Start Server

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start
```

Or for development:

```bash
npm run dev
```

### Verify Server is Running

```bash
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

## Step 5: Deploy n8n Workflows

### 5.1 Push Workflows to n8n

```bash
# Push workflows to n8n instance
npm run n8n:push
```

Or manually import:
1. Go to your n8n instance
2. Import workflows from `workflows/*.workflow.json`
3. Configure credentials:
   - MCP API key for HTTP requests
   - OpenAI API key for LLM nodes
   - Platform API keys (TikTok, YouTube, etc.)

### 5.2 Configure n8n Environment

In n8n settings, configure:
- **MCP Server URL:** `https://mcp-vector.mjames.dev/mcp`
- **MCP API Key:** Your `MCP_API_KEY`
- **API Base URL:** `https://mcp-vector.mjames.dev/api`

### 5.3 Activate Workflows

Activate these workflows in n8n:
- `Generate Ideas` (with HITL)
- `Screen Writer` (with HITL)
- `Make Videos` (with HITL)
- `Post Video`

## Step 6: Deploy HITL UI

The HITL UI is served statically from the Fastify server.

### Verify UI is Accessible

```bash
curl http://localhost:3000/hitl
# Should return HTML page
```

### Access UI

Navigate to: `https://mcp-vector.mjames.dev/hitl`

Features:
- View pending approvals
- Filter by stage/project
- Approve/reject items
- Provide feedback

## Step 7: Configure Notifications

### Slack Notifications

If using Slack for HITL notifications:

1. Create Slack webhook in Slack workspace
2. Add `SLACK_WEBHOOK_URL` to `.env`
3. Restart server

Notifications will be sent when:
- New HITL approval is requested
- Approval status changes

### Email Notifications (Optional)

Configure SMTP settings in `.env` for email notifications.

## Step 8: Monitoring and Health Checks

### Health Endpoint

```bash
curl http://localhost:3000/health
```

### Database Health

Check database connectivity:

```bash
curl http://localhost:3000/api/admin/features
# Returns database status
```

### Workflow Run Status

```bash
# List recent workflow runs
curl http://localhost:3000/api/workflow-runs?limit=10
```

## Step 9: Testing End-to-End Flow

### 9.1 Create Workflow Run

```bash
curl -X POST http://localhost:3000/api/workflow-runs \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "aismr",
    "sessionId": "test-session-id",
    "input": {
      "userInput": "Create an ASMR video about puppies"
    }
  }'
```

### 9.2 Trigger Idea Generation

Trigger via n8n workflow or API:
- n8n: Execute `Generate Ideas` workflow
- API: Call workflow webhook

### 9.3 Check HITL Approval

1. Go to `/hitl` UI
2. See pending approval for idea generation
3. Approve/reject idea
4. Workflow continues automatically

### 9.4 Verify Completion

Check workflow run status:

```bash
curl http://localhost:3000/api/workflow-runs/{workflowRunId}
```

Should show progression through stages:
- `idea_generation` → `screenplay` → `video_generation` → `publishing`

## Troubleshooting

### Database Connection Issues

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check pgvector extension
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

### Workflow Definitions Not Found

1. Verify ingestion: `npm run ingest:prompts`
2. Check RAG search:
   ```bash
   curl "http://localhost:3000/api/prompts/search?q=workflow+definition"
   ```
3. Verify file paths match ingestion script expectations

### HITL Approvals Not Appearing

1. Check workflow run status: Should be `waiting_for_hitl`
2. Check HITL repository: `SELECT * FROM hitl_approvals WHERE status = 'pending'`
3. Verify API endpoint: `GET /api/hitl/pending`

### n8n Workflow Errors

1. Check n8n execution logs
2. Verify MCP connection:
   - Endpoint URL correct
   - API key valid
   - Network accessible
3. Check workflow JSON syntax

## Production Checklist

- [ ] Database migrations applied
- [ ] Workflow definitions ingested
- [ ] Environment variables configured
- [ ] Server running and healthy
- [ ] n8n workflows deployed and active
- [ ] HITL UI accessible
- [ ] Notifications configured
- [ ] End-to-end test completed
- [ ] Monitoring set up
- [ ] Backup strategy in place

## Backup Strategy

### Database Backups

```bash
# Main database
pg_dump $DATABASE_URL > backup_prompts.sql

# Operations database
pg_dump $OPERATIONS_DATABASE_URL > backup_operations.sql
```

### Workflow Definitions

Workflow JSON files are version-controlled in Git, but also backup:
- `prompts/workflows/*.json`
- `prompts/projects/*.json`

## Scaling Considerations

### Database Performance

- Indexes are already created for common queries
- Monitor query performance
- Consider partitioning `workflow_runs` by date if volume is high

### API Rate Limiting

Configure rate limiting in `src/server/httpTransport.ts`:
- Adjust `RATE_LIMIT_PER_MINUTE`
- Configure per-IP vs per-API-key limits

### n8n Execution

- Use n8n queue mode for high volume
- Consider separate n8n instances per project
- Monitor workflow execution times

## Security

- [ ] API keys stored securely (not in code)
- [ ] Database credentials secured
- [ ] HTTPS enabled for production
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Authentication required for admin endpoints

## Next Steps

After deployment:
1. Monitor error logs
2. Track workflow completion rates
3. Gather user feedback on HITL UI
4. Iterate on workflow definitions based on results
5. Add new projects following `ADDING_NEW_PROJECTS.md`

