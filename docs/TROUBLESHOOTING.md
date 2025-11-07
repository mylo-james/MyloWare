# Troubleshooting Guide

Common issues and solutions for MCP Prompts V2.

---

## Table of Contents

1. [Database Issues](#database-issues)
2. [Workflow Execution Issues](#workflow-execution-issues)
3. [Memory Search Issues](#memory-search-issues)
4. [n8n Integration Issues](#n8n-integration-issues)
5. [Session Management Issues](#session-management-issues)
6. [Performance Issues](#performance-issues)
7. [Deployment Issues](#deployment-issues)

---

## Database Issues

### Error: "relation does not exist"

**Symptoms:**
- Database queries fail with "relation X does not exist"
- Tables missing after deployment

**Solution:**
```bash
# Run migrations
npm run db:migrate

# Or push schema directly
npx drizzle-kit push
```

### Error: "extension vector does not exist"

**Symptoms:**
- Vector operations fail
- pgvector extension not found

**Solution:**
```bash
# Connect to database
psql $DATABASE_URL

# Create extension
CREATE EXTENSION IF NOT EXISTS vector;

# Verify
\dx vector
```

### Error: "n8n workflow mapping missing"

**Symptoms:**
- Workflow execution fails with "No n8n workflow mapped"
- Prompt/workflow delegation fails immediately

**Solution:**
1. Seed or import workflows so procedural memories exist: `npm run db:seed:workflows`
2. Import the latest n8n workflows: `npm run import:workflows`
3. Attach the n8n workflow IDs to the procedural memories either by setting the `N8N_WORKFLOW_ID_*` env vars before seeding or by running `REGISTER_WORKFLOWS=true npm run import:workflows`
4. Verify each workflow memory contains `metadata.n8nWorkflowId`:
   ```bash
   psql $DATABASE_URL -c "SELECT id, metadata->>'n8nWorkflowId' AS n8n_id FROM memories WHERE memory_type='procedural';"
   ```

If the column shows NULL, update the memory metadata (use `scripts/register-workflow-mappings.ts` or rerun the import with `REGISTER_WORKFLOWS=true`).

---

## Workflow Execution Issues

### Error: "No n8n workflow mapped to memory ID"

**Symptoms:**
- `workflow_execute` fails with NotFoundError
- Workflows discovered but can't execute

**Solution:**
```bash
# 1. Ensure workflows are seeded
npm run db:seed:workflows

# 2. Import workflows to n8n
npm run import:workflows

# 3. Capture the n8n workflow IDs from the import output and either:
#    a) set N8N_WORKFLOW_ID_* env vars before re-seeding, or
#    b) run REGISTER_WORKFLOWS=true npm run import:workflows to attach IDs to existing memories
```

### Error: "Workflow execution timeout"

**Symptoms:**
- Workflows timeout after 5 minutes
- Long-running workflows fail

**Solution:**
- Check n8n workflow execution time
- Verify n8n is running and accessible
- Check network connectivity between MCP server and n8n
- Consider increasing timeout in `executeTool.ts` (default: 300000ms)

### Error: "n8n API error: 404"

**Symptoms:**
- Workflow execution fails with 404
- n8n can't find workflow

**Solution:**
- Verify the workflow memory has the correct `metadata.n8nWorkflowId`
- Check if workflow exists in n8n: `curl https://n8n.yourdomain.com/api/v1/workflows/<id>`
- Ensure workflow is active in n8n UI
- Re-import workflow or update metadata if needed

---

## Memory Search Issues

### Error: "No memories found"

**Symptoms:**
- Memory search returns empty results
- Workflow discovery finds nothing

**Solution:**
```bash
# Check if memories exist
psql $DATABASE_URL -c "SELECT COUNT(*) FROM memories;"

# Seed test data
npm run db:seed:test

# Seed workflows
npm run db:seed:workflows
```

### Error: "ValidationError: query contains newlines"

**Symptoms:**
- Memory search fails with validation error
- Multi-line queries rejected

**Solution:**
- Ensure queries are single-line
- Use workflow parameter mapping for multi-line content
- The `cleanForAI` utility automatically handles this

### Poor Search Results

**Symptoms:**
- Search returns irrelevant results
- Semantic similarity not working

**Solution:**
- Verify OpenAI API key is valid
- Check embedding generation: `curl https://mcp.yourdomain.com/health`
- Ensure embeddings are being generated (check `memories.embedding` column)
- Verify vector index exists: `\d+ memories` (should show `memories_embedding_idx`)

---

## n8n Integration Issues

### Error: "n8n API request failed"

**Symptoms:**
- Can't connect to n8n
- Workflow imports fail

**Solution:**
```bash
# Check n8n is running
curl https://n8n.yourdomain.com/healthz

# Verify n8n API key
curl -H "X-N8N-API-KEY: $N8N_API_KEY" \
  https://n8n.yourdomain.com/api/v1/workflows

# Check network connectivity
docker exec mcp-server ping n8n
```

### Error: "MCP tools not accessible from n8n"

**Symptoms:**
- n8n can't call MCP tools
- Tool calls fail

**Solution:**
1. Verify MCP server URL in n8n workflow is correct
2. Check MCP server is accessible from n8n:
   ```bash
   # From n8n container
   curl http://mcp-server:3000/health
   ```
3. Verify MCP auth key matches (if configured)
4. Check n8n workflow has correct MCP tool node configuration

### Workflow URLs Wrong

**Symptoms:**
- n8n workflows call wrong endpoints
- Local development hits production

**Solution:**
- Update workflow JSON files with correct URLs
- For local: `http://mcp-server:3000/mcp`
- For production: `https://mcp.yourdomain.com/mcp`
- Re-import workflows after updating

---

## Session Management Issues

### Error: "Session userId missing platform prefix"

**Symptoms:**
- User IDs stored as "123" instead of "telegram:123"
- Can't distinguish between platforms

**Solution:**
- This is fixed in the current version
- Verify `session_get_context` tool preserves full userId
- Check session repository uses full sessionId as userId

### Error: "Persona/project not preserved"

**Symptoms:**
- Sessions always use 'chat' persona
- Project always defaults to 'aismr'

**Solution:**
- Verify session tool accepts optional `persona` and `project` params
- Check existing sessions have correct values
- Update session creation to use stored values if available

---

## Performance Issues

### Slow Memory Searches

**Symptoms:**
- Search takes >1 second
- High database CPU usage

**Solution:**
```sql
-- Check if vector index exists
\d+ memories

-- Create index if missing
CREATE INDEX IF NOT EXISTS memories_embedding_idx 
ON memories USING hnsw (embedding vector_cosine_ops);

-- Analyze table for query planner
ANALYZE memories;
```

### High Memory Usage

**Symptoms:**
- Server running out of memory
- OOM errors

**Solution:**
- Reduce connection pool size in database config
- Limit concurrent workflow executions
- Monitor memory usage: `docker stats mcp-server`
- Consider increasing container memory limits

### Rate Limiting Too Aggressive

**Symptoms:**
- Legitimate requests blocked
- 429 errors

**Solution:**
- Increase rate limit: `RATE_LIMIT_MAX=200`
- Adjust time window: `RATE_LIMIT_TIME_WINDOW=1 minute`
- Check rate limit key generator (should use API key if available)

---

## Deployment Issues

### Error: "Cannot connect to database"

**Symptoms:**
- Server fails to start
- Database connection errors

**Solution:**
```bash
# Verify database is accessible
psql $DATABASE_URL -c "SELECT 1"

# Check connection string format
echo $DATABASE_URL
# Should be: postgresql://user:password@host:port/database

# Verify network connectivity
docker exec mcp-server ping postgres-host
```

### Error: "Telegram token required"

**Symptoms:**
- Server crashes on startup
- Config validation fails

**Solution:**
- Telegram is now optional in current version
- If error persists, verify `src/config/index.ts` has telegram as optional
- Or set `TELEGRAM_BOT_TOKEN` environment variable

### Error: "CORS errors"

**Symptoms:**
- Browser requests blocked
- CORS policy errors

**Solution:**
```bash
# Update ALLOWED_ORIGINS
export ALLOWED_ORIGINS=https://yourdomain.com,https://n8n.yourdomain.com

# Restart server
docker compose restart mcp-server
```

### Health Check Failing

**Symptoms:**
- `/health` endpoint returns errors
- Monitoring alerts firing

**Solution:**
```bash
# Check health endpoint
curl https://mcp.yourdomain.com/health

# Check individual components
psql $DATABASE_URL -c "SELECT 1"  # Database
curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"  # OpenAI

# Check logs
docker compose logs mcp-server | tail -50
```

---

## Common Error Messages

### "No n8n workflow mapped to memory ID"

**Cause:** The workflow memory is missing `metadata.n8nWorkflowId` (or the ID is stale).

**Fix:**
1. Import workflows: `npm run import:workflows`
2. Seed workflows: `npm run db:seed:workflows`
3. Attach IDs: `REGISTER_WORKFLOWS=true npm run import:workflows` or run `scripts/register-workflow-mappings.ts`

### "Workflow execution timeout"

**Cause:** Workflow takes longer than 5 minutes.

**Fix:**
- Check n8n workflow execution time
- Increase timeout in code if needed
- Optimize workflow steps

### "ValidationError: query contains newlines"

**Cause:** Query parameter has newline characters.

**Fix:**
- Use single-line queries
- Strip newlines before calling search tool
- Use `cleanForAI` utility

### "n8n API error: 404"

**Cause:** n8n workflow ID doesn't exist or is incorrect.

**Fix:**
- Verify the workflow memory has the correct `metadata.n8nWorkflowId` value
- Check workflow exists in n8n
- Re-import workflow if needed

---

## Debugging Tips

### Enable Debug Logging

```bash
export LOG_LEVEL=debug
docker compose restart mcp-server
```

### Check Database State

```bash
# Connect to database
psql $DATABASE_URL

# Check recent memories
SELECT id, content, memory_type FROM memories ORDER BY created_at DESC LIMIT 10;

# Check sessions
SELECT id, user_id, persona, project FROM sessions;
```

### Test MCP Tools Directly

```bash
# List tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $MCP_AUTH_KEY" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $MCP_AUTH_KEY" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"memory_search",
      "arguments":{"query":"test","limit":5}
    },
    "id":1
  }'
```

### Check Metrics

```bash
# View Prometheus metrics
curl http://localhost:3000/metrics | grep workflow

# Key metrics to monitor:
# - workflow_executions_total
# - workflow_duration_seconds
# - mcp_tool_call_errors_total
```

---

## Getting Help

If you're still experiencing issues:

1. **Check logs:**
   ```bash
   docker compose logs mcp-server --tail=100
   ```

2. **Verify configuration:**
   ```bash
   # Check environment variables
   docker compose exec mcp-server env | grep -E "(DATABASE|OPENAI|N8N)"
   ```

3. **Test connectivity:**
   ```bash
   # Database
   docker compose exec mcp-server psql $DATABASE_URL -c "SELECT 1"
   
   # n8n
   docker compose exec mcp-server curl http://n8n:5678/healthz
   ```

4. **Review error details:**
   - Check error messages in logs
   - Verify error includes context (workflowId, sessionId, etc.)
   - Check if error is retryable (network issues vs validation errors)

---

## Prevention

**Best Practices:**

1. **Monitor health checks** - Set up alerts for `/health` endpoint
2. **Log aggregation** - Use structured logging and aggregate logs
3. **Metrics** - Monitor Prometheus metrics for anomalies
4. **Backups** - Regular database backups, especially memories (procedural workflows)
5. **Testing** - Run integration tests before deployment
6. **Documentation** - Keep deployment docs updated with changes

---

## Quick Reference

**Common Commands:**

```bash
# Check health
curl http://localhost:3000/health

# View metrics
curl http://localhost:3000/metrics

# Check logs
docker compose logs mcp-server

# Run migrations
npm run db:migrate

# Seed workflows
npm run db:seed:workflows

# Import workflows
npm run import:workflows

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```
