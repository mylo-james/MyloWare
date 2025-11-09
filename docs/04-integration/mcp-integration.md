# MCP Integration Guide

**Audience:** Developers integrating MCP clients  
**Outcome:** Successfully connect and call MCP tools

---

## Overview

MyloWare implements the full Model Context Protocol (MCP) specification for tool calling, resources, and prompts.

**Protocol:** JSON-RPC 2.0 over HTTP  
**Endpoint:** `https://mcp-vector.mjames.dev/mcp` (production) or `http://localhost:3456/mcp` (local)

---

## Prerequisites

- MCP server running (see [Quick Start](../01-getting-started/quick-start.md))
- API key (set in `.env` as `MCP_AUTH_KEY`)

---

## Official MCP Documentation

Use Context7 to fetch the latest MCP specification:

```
Context7: /modelcontextprotocol/specification
```

This provides up-to-date protocol details, authentication patterns, and best practices.

---

## Authentication

All requests require an `X-API-Key` header:

```bash
curl -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-bot" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Quick Start

### 1. List Available Tools

```bash
curl -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-bot" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### 2. Call a Tool

```bash
curl -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-bot" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "memory_search",
      "arguments": {
        "query": "AISMR ideas",
        "limit": 5
      }
    }
  }'
```

---

## Client Examples

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "myloware": {
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

Restart Claude Desktop to load the server.

### n8n Workflow

Use HTTP Request node:

**Method:** POST  
**URL:** `https://mcp-vector.mjames.dev/mcp`  
**Headers:**
```
Content-Type: application/json
X-API-Key: mylo-mcp-bot
Accept: application/json, text/event-stream
```

**Body:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "trace_create",
    "arguments": {
      "projectId": "550e8400-e29b-41d4-a716-446655440000",
      "sessionId": "telegram:123"
    }
  }
}
```

For n8n-specific patterns, see [n8n Universal Workflow](n8n-universal-workflow.md).

### Cursor

See [Cursor MCP Setup](cursor-mcp-setup.md) for Cursor-specific configuration.

---

## Available Tools

For complete tool reference, see [MCP Tools](../06-reference/mcp-tools.md).

**Core tools:**
- `memory_search` - Find memories by semantic similarity
- `memory_store` - Save new memories with auto-embedding
- `trace_create` - Start new production run
- `handoff_to_agent` - Transfer ownership between agents
- `context_get_persona` - Load agent configuration
- `context_get_project` - Load project specs

---

## Common Patterns

### Create Trace and Hand Off

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "trace_create",
    "arguments": {
      "projectId": "550e8400-e29b-41d4-a716-446655440000",
      "sessionId": "telegram:123",
      "metadata": {
        "source": "api",
        "userMessage": "Make AISMR candles video"
      }
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"traceId\":\"trace-001\",\"status\":\"active\",...}"
    }]
  }
}
```

### Search Memories by Trace

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "memory_search",
    "arguments": {
      "query": "Iggy's modifiers",
      "traceId": "trace-001",
      "project": "aismr",
      "memoryTypes": ["episodic"],
      "limit": 12
    }
  }
}
```

### Store Memory with Trace Tag

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "memory_store",
    "arguments": {
      "content": "Generated 12 AISMR modifiers: Void, Liquid, Crystal...",
      "memoryType": "episodic",
      "persona": ["iggy"],
      "project": ["aismr"],
      "tags": ["ideas", "generated"],
      "metadata": {
        "traceId": "trace-001",
        "object": "candles"
      }
    }
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
    "data": {
      "details": "..."
    }
  }
}
```

**Common error codes:**
- `-32000` - Bad Request (missing required parameter)
- `-32001` - Unauthorized (invalid API key)
- `-32602` - Invalid Params (schema validation failed)
- `-32603` - Internal Error (server-side error)

---

## Session Management

MCP supports stateful sessions via `mcp-session-id` header.

### First Request

```bash
curl -X POST http://localhost:3456/mcp \
  -H "X-API-Key: mylo-mcp-bot" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

Server returns `mcp-session-id` header.

### Subsequent Requests

Include session ID:

```bash
curl -X POST http://localhost:3456/mcp \
  -H "X-API-Key: mylo-mcp-bot" \
  -H "mcp-session-id: abc123-def456" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

---

## Resources API

Access personas and projects as resources:

### List Resources

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list"
}
```

### Read Resource

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "personas://casey"
  }
}
```

**Available resources:**
- `personas://list` - All personas
- `personas://{name}` - Specific persona
- `projects://list` - All projects
- `projects://{slug}` - Specific project
- `sessions://{sessionId}/context` - Session context

---

## Prompts API

Use pre-built prompt templates:

### List Prompts

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "prompts/list"
}
```

### Get Prompt

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "aismr-video-creation",
    "arguments": {
      "topic": "rain sounds"
    }
  }
}
```

---

## Best Practices

1. **Always include Accept header** - Required: `application/json, text/event-stream`
2. **Reuse sessions** - Include `mcp-session-id` for stateful operations
3. **Handle errors gracefully** - Check `error` field in responses
4. **Tag memories with traceId** - Enable trace-scoped coordination
5. **Use Context7 for vendor docs** - Fetch latest MCP spec when needed

---

## Validation

✅ Can list tools via `tools/list`  
✅ Can call tools via `tools/call`  
✅ Can read resources via `resources/read`  
✅ Errors return proper JSON-RPC format  
✅ Session ID persists across requests

---

## Next Steps

- [MCP Tools Reference](../06-reference/mcp-tools.md) - Complete tool catalog
- [n8n Universal Workflow](n8n-universal-workflow.md) - Workflow integration
- [Cursor MCP Setup](cursor-mcp-setup.md) - Cursor configuration

---

## Troubleshooting

**401 Unauthorized?**
- Verify `X-API-Key` header matches `.env` value
- Check API key is set in environment

**400 Bad Request?**
- Ensure `Accept` header includes `text/event-stream`
- Verify JSON-RPC format is correct

**Tool not found?**
- Call `tools/list` to see available tools
- Check tool name spelling

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.
