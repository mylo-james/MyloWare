# MCP Integration Guide

This guide explains how to connect various MCP clients to the mcp-prompts-v2 server.

---

## Overview

The mcp-prompts-v2 server implements the full Model Context Protocol specification:

- **Tools API** - 11 tools for memory, context, workflows, and sessions
- **Resources API** - Access personas, projects, and session context as resources
- **Prompts API** - Reusable prompt templates for common workflows

---

## Server Endpoint

**Base URL:** `https://mcp-vector.mjames.dev/mcp` (production)  
**Local:** `http://localhost:3456/mcp` (development)

**Protocol:** Streamable HTTP (JSON-RPC 2.0 over HTTP)

---

## Authentication

### API Key Authentication

All requests require an `X-API-Key` header:

```bash
curl -X POST https://mcp-vector.mjames.dev/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

**Note:** OAuth 2.1 with PKCE is planned but not yet implemented. API key auth is sufficient for protected/internal deployments.

---

## Connecting Claude Desktop

### Configuration

Add to your Claude Desktop MCP configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-prompts": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-cli",
        "http",
        "https://mcp-vector.mjames.dev/mcp",
        "--header",
        "X-API-Key:your-api-key-here"
      ]
    }
  }
}
```

### Restart Claude Desktop

After updating the config, restart Claude Desktop to load the new MCP server.

### Usage

Once connected, Claude Desktop will discover:
- **11 Tools** - Callable via function calling
- **5 Resources** - Browseable via resource links
- **3 Prompts** - Available as prompt templates

Example interaction:
```
Claude: I can help you search memories, discover workflows, or create AISMR videos.
        Would you like me to search your memory for context?
```

---

## Connecting n8n

### HTTP Request Node

Configure an HTTP Request node in n8n:

**Method:** POST  
**URL:** `https://mcp-vector.mjames.dev/mcp`  
**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key-here
Accept: application/json, text/event-stream
```

**Body (JSON):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "memory_search",
    "arguments": {
      "query": "AISMR video ideas",
      "limit": 5
    }
  }
}
```

### Example Workflow

1. **Initialize Session** - Send `initialize` request
2. **Call Tool** - Use `tools/call` to execute operations
3. **Read Resource** - Use `resources/read` to access data
4. **Get Prompt** - Use `prompts/get` for templates

---

## Using the Three APIs

### 1. Tools API

Call functions to perform operations:

**List Tools:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Call Tool:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "memory_search",
    "arguments": {
      "query": "rain sounds",
      "memoryTypes": ["episodic", "semantic"],
      "limit": 10
    }
  }
}
```

**Available Tools:**
- `memory_search` - Search memories
- `memory_store` - Store new memory
- `memory_evolve` - Update memory
- `context_get_persona` - Load persona
- `context_get_project` - Load project
- `workflow_discover` - Find workflows
- `workflow_execute` - Execute workflow
- `workflow_status` - Check status
- `clarify_ask` - Request clarification
- `session_get_context` - Get session
- `session_update_context` - Update session

### 2. Resources API

Access data as resources (like files):

**List Resources:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/list"
}
```

**Read Resource:**
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "resources/read",
  "params": {
    "uri": "personas://casey"
  }
}
```

**Available Resources:**
- `personas://list` - List all personas
- `personas://{name}` - Get persona config
- `projects://list` - List all projects
- `projects://{name}` - Get project config
- `sessions://{sessionId}/context` - Get session context

**Subscribe to Updates:**
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "resources/subscribe",
  "params": {
    "uri": "sessions://telegram:123456/context"
  }
}
```

### 3. Prompts API

Use pre-built prompt templates:

**List Prompts:**
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "prompts/list"
}
```

**Get Prompt:**
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "prompts/get",
  "params": {
    "name": "aismr-video-creation",
    "arguments": {
      "topic": "rain sounds",
      "style": "rain"
    }
  }
}
```

**Available Prompts:**
- `aismr-video-creation` - Full video production workflow
- `memory-chat` - Memory-assisted conversation
- `discover-workflow` - Workflow discovery assistant

---

## Session Management

The server supports session-based connections for stateful clients.

### Initialization

1. Send `initialize` request without `mcp-session-id` header
2. Server creates new session and returns session ID in response headers
3. Subsequent requests include `mcp-session-id` header

**First Request:**
```bash
curl -X POST https://mcp-vector.mjames.dev/mcp \
  -H "X-API-Key: your-key" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

**Response Headers:**
```
mcp-session-id: abc123-def456-...
```

**Subsequent Requests:**
```bash
curl -X POST https://mcp-vector.mjames.dev/mcp \
  -H "X-API-Key: your-key" \
  -H "mcp-session-id: abc123-def456-..." \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

---

## Testing the Connection

### Health Check

```bash
curl https://mcp-vector.mjames.dev/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "service": "mcp-server",
  "checks": {
    "database": "ok",
    "openai": "ok",
    "tools": "{\"memory_search\":\"ok\",...}"
  }
}
```

### Test Tool Call

```bash
curl -X POST https://mcp-vector.mjames.dev/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

Expected response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "memory_search",
        "description": "Search memories using hybrid vector + keyword retrieval",
        "inputSchema": {...}
      },
      ...
    ]
  }
}
```

---

## Error Handling

All errors follow JSON-RPC 2.0 format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal server error",
    "data": {...}
  }
}
```

**Common Error Codes:**
- `-32000` - Bad Request (missing session ID, invalid parameters)
- `-32001` - Unauthorized (missing/invalid API key)
- `-32603` - Internal Error (server-side error)
- `-32602` - Invalid Params (schema validation failed)

---

## Best Practices

1. **Always include Accept header** - Required: `application/json, text/event-stream`
2. **Reuse sessions** - Include `mcp-session-id` header for stateful operations
3. **Handle errors gracefully** - Check `isError` flag in tool responses
4. **Use structured content** - Tool responses include both `content` and `structuredContent`
5. **Subscribe to resources** - Use `resources/subscribe` for real-time updates

---

## Examples

### Complete Workflow: Create AISMR Video

```javascript
// 1. Initialize session
const initResponse = await fetch('https://mcp-vector.mjames.dev/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-key',
    'Accept': 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'my-client', version: '1.0.0' }
    }
  })
});

const sessionId = initResponse.headers.get('mcp-session-id');

// 2. Get prompt template
const promptResponse = await fetch('https://mcp-vector.mjames.dev/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-key',
    'mcp-session-id': sessionId,
    'Accept': 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'prompts/get',
    params: {
      name: 'aismr-video-creation',
      arguments: {
        topic: 'rain sounds',
        style: 'rain'
      }
    }
  })
});

// 3. Discover workflow
const workflowResponse = await fetch('https://mcp-vector.mjames.dev/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-key',
    'mcp-session-id': sessionId,
    'Accept': 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'workflow_discover',
      arguments: {
        intent: 'create AISMR video from idea to upload',
        project: 'aismr'
      }
    }
  })
});

// 4. Execute workflow
const executeResponse = await fetch('https://mcp-vector.mjames.dev/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-key',
    'mcp-session-id': sessionId,
    'Accept': 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'workflow_execute',
      arguments: {
        workflowId: 'workflow-id-from-discovery',
        input: { topic: 'rain sounds', style: 'rain' }
      }
    }
  })
});
```

---

## Troubleshooting

### Connection Issues

**Problem:** 401 Unauthorized  
**Solution:** Check `X-API-Key` header is correct

**Problem:** 400 Bad Request  
**Solution:** Ensure `Accept` header includes `application/json, text/event-stream`

**Problem:** Session not found  
**Solution:** Send `initialize` request first to create session

### Tool Call Issues

**Problem:** Invalid params error  
**Solution:** Check tool input schema - all required fields must be provided

**Problem:** Tool not found  
**Solution:** Call `tools/list` to see available tools

### Resource Issues

**Problem:** Resource not found  
**Solution:** Call `resources/list` to see available resource URIs

---

## Additional Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Tools Documentation](MCP_TOOLS.md)
- [Architecture Overview](ARCHITECTURE.md)

---

**Ready to integrate?** Start with Claude Desktop for the easiest setup, or use HTTP requests for custom clients!

