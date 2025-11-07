# Cursor MCP Setup Guide

## Current Status

✅ **Dev server is running and healthy** on `http://localhost:3456`  
✅ **All 11 tools loaded** (memory, context, workflow, session, docs)  
✅ **Authentication configured** (`X-API-Key: mylo-mcp-bot`)

## Configure Cursor to Connect

### Option 1: Via Cursor Settings UI (Recommended)

1. Open Cursor Settings (⌘ + ,)
2. Search for "MCP" or "Model Context Protocol"
3. Click "Edit in settings.json" if available
4. Add the following configuration to your `settings.json`:

```json
{
  "mcp.servers": {
    "mcp-prompts": {
      "type": "http",
      "url": "http://localhost:3456/mcp",
      "headers": {
        "X-API-Key": "mylo-mcp-bot",
        "Accept": "application/json, text/event-stream"
      },
      "enabled": true
    }
  }
}
```

### Option 2: Edit Settings File Directly

Edit this file:
```
~/Library/Application Support/Cursor/User/settings.json
```

Add the MCP configuration above to your existing settings.

### Option 3: Use Claude Desktop Format (If Supported)

If Cursor supports Claude Desktop-style MCP configuration, create:
```
~/Library/Application Support/Cursor/mcp_settings.json
```

With this content:
```json
{
  "mcpServers": {
    "mcp-prompts": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-cli",
        "http",
        "http://localhost:3456/mcp",
        "--header",
        "X-API-Key:mylo-mcp-bot"
      ]
    }
  }
}
```

## Verify Connection

### 1. Check Server Health
```bash
curl http://localhost:3456/health
```

Should return:
```json
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "openai": "ok",
    "tools": "..."
  }
}
```

### 2. Test MCP Endpoint
```bash
curl -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-bot" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### 3. Restart Cursor

After adding the configuration:
1. Save the settings file
2. Completely quit Cursor (⌘ + Q)
3. Reopen Cursor
4. Check if MCP tools appear in the AI chat

## Available Tools

Once connected, you'll have access to:

1. **memory_search** – Hybrid retrieval across vectors + keywords
2. **memory_store** – Persist episodic/procedural memories with metadata
3. **memory_evolve** – Update tags, links, and summaries in-place
4. **memory_searchByRun** – Look up memories tied to a legacy `runId`
5. **context_get_persona** – Load persona configuration & guardrails
6. **context_get_project** – Load project-level constraints
7. **trace_create** – Start a new trace + return a `traceId`
8. **handoff_to_agent** – Resolve & invoke the next agent’s webhook via n8n
9. **workflow_complete** – Mark traces as completed/failed with outputs
10. **session_get_context** – Hydrate or create a chat session
11. **session_update_context** – Persist session working memory

Clarifications now happen through Telegram approval nodes, so there is no standalone `clarify_ask` tool anymore.

## Troubleshooting

### MCP Server Not Appearing in Cursor

1. **Check server is running:**
   ```bash
   docker ps | grep mcp-server-dev
   ```

2. **Check logs:**
   ```bash
   docker logs mcp-server-dev --tail 50
   ```

3. **Restart dev server:**
   ```bash
   cd /Users/mjames/Code/mcp-prompts
   docker compose --profile dev restart mcp-server-dev
   ```

### Authentication Errors

If you see "Unauthorized" errors, verify your auth key matches:
```bash
grep MCP_AUTH_KEY /Users/mjames/Code/mcp-prompts/.env
```

### Connection Refused

1. Verify port 3456 is accessible:
   ```bash
   curl http://localhost:3456/health
   ```

2. Check Docker networking:
   ```bash
   docker port mcp-server-dev
   ```

## Alternative: Use the Production Server

If you want to use the production server instead:

1. Switch Docker profile:
   ```bash
   docker compose --profile dev down
   docker compose --profile prod up -d
   ```

2. Update Cursor settings to use:
   - URL: `https://mcp-vector.mjames.dev/mcp`
   - Same auth header

## Need Help?

- Check server logs: `docker logs mcp-server-dev -f`
- View Docker status: `docker compose ps`
- Health check: `curl http://localhost:3456/health`
- Full docs: See [MCP_INTEGRATION.md](docs/MCP_INTEGRATION.md)
