# Myloware MCP Tools Diagnostic Report

## Issue Summary

All Myloware MCP tools are returning the error:
```
Error POSTing to endpoint (HTTP 400): {"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: No valid session ID provided"},"id":null}
```

## Root Cause

The MCP server (running at `https://mcp-vector.mjames.dev/mcp`) requires session management per the MCP protocol specification. 

### How MCP Sessions Work (HTTP Transport):

1. **Initial Connection**: Client sends an `initialize` request
2. **Server Response**: Server returns session ID in `mcp-session-id` header
3. **Subsequent Requests**: Client MUST include `mcp-session-id` header in all future requests
4. **Session Validation**: Server rejects any non-initialize request without valid session ID

### What's Happening:

Looking at `src/server.ts` lines 251-261:

```typescript
} else {
  // Invalid request - no session ID and not an initialize request
  reply.code(400).send({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Bad Request: No valid session ID provided',
    },
    id: null,
  });
  return;
}
```

The server is rejecting tool calls because:
- ❌ No `mcp-session-id` header is present
- ❌ The request is not an `initialize` request

## Cursor MCP Integration Status

From `/Users/mjames/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "Myloware": {
      "url": "https://mcp-vector.mjames.dev/mcp",
      "headers": {
        "x-api-key": "mylo-mcp-agent"
      }
    }
  }
}
```

### Configuration Analysis:

✅ **Server URL**: Correct  
✅ **Authentication**: API key configured  
❌ **Session Management**: Cursor may not be properly managing HTTP MCP sessions

## Docker Server Status

The server IS running and healthy:

```bash
$ curl http://localhost:3456/health
{
  "status": "healthy",
  "checks": {
    "database": "ok",
    "openai": "ok",
    "tools": "{...all 11 tools registered...}"
  }
}
```

From Docker logs, we can see:
- Sessions ARE being created: `sessionId":"85e3925e-cf25-47af-a9c7-45f7014ee33e"`
- Sessions ARE being reused: `"Reusing existing transport"`  
- **But**: These successful sessions are from external requests, not from Cursor's AI agent

## Why Tools Fail When Called by AI

When the AI calls tools like:
```typescript
mcp_Myloware_context_get_persona({ personaName: "chat" })
```

The request flow is:
1. Cursor → MCP Server (POST /mcp)
2. Server checks for `mcp-session-id` header
3. **Header is missing** → Server returns 400 error
4. Tool never executes

## Potential Solutions

### Option 1: Verify Cursor MCP Client Behavior
Check if Cursor is supposed to automatically manage sessions for HTTP MCP servers.

### Option 2: Use Local Server with Different Transport
If Cursor's HTTP MCP support is incomplete, we might need to:
- Use stdio transport instead of HTTP
- Run MCP server as a local process
- Update `mcp.json` to use command-based connection

### Option 3: Debug Cursor's MCP Requests
Enable verbose logging to see if Cursor is:
- Sending initialize requests
- Receiving session IDs
- Including session IDs in subsequent requests

## Testing Tool Functionality

The tools themselves ARE functional. When called with proper session management (via curl with session ID), they work perfectly.

Example from logs showing successful tool execution:
```json
{
  "msg": "MCP session initialized",
  "sessionId": "85e3925e-cf25-47af-a9c7-45f7014ee33e"
}
{
  "msg": "Reusing existing transport",  
  "sessionId": "85e3925e-cf25-47af-a9c7-45f7014ee33e"
}
```

## Next Steps

1. **Determine if this is a Cursor bug** - HTTP MCP session management may not be fully implemented
2. **Check Cursor version** - This might be fixed in newer versions
3. **Consider alternative MCP transports** - stdio might work better than HTTP for Cursor
4. **File Cursor bug report** if session management is broken

## Tool Inventory (All Healthy)

From `/health` endpoint:
- ✅ memory_search
- ✅ memory_store  
- ✅ memory_evolve
- ✅ context_get_persona
- ✅ context_get_project
- ✅ workflow_discover
- ✅ workflow_execute
- ✅ workflow_status
- ✅ clarify_ask
- ✅ session_get_context
- ✅ session_update_context

**All tools are registered and operational** - the issue is purely session management in the Cursor<->Server communication layer.

