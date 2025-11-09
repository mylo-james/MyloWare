# API Endpoints Reference

**Auto-generated documentation**  
**Last updated:** 2025-01-09

---

## Overview

MyloWare exposes HTTP endpoints for health checks, metrics, and MCP protocol.

**Base URL:**
- Production: `https://mcp-vector.mjames.dev`
- Local: `http://localhost:3456`

---

## Health Check

### GET /health

Check service health and dependencies.

**Authentication:** None required

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-09T12:00:00.000Z",
  "service": "mcp-server",
  "checks": {
    "database": "ok",
    "openai": "ok",
    "tools": "{\"memory_search\":\"ok\",...}"
  }
}
```

**Status codes:**
- `200` - All checks passed
- `503` - One or more checks failed

**Example:**
```bash
curl http://localhost:3456/health
```

---

## Metrics

### GET /metrics

Prometheus metrics endpoint.

**Authentication:** None required (restrict in production)

**Metrics:**
- `mcp_tool_call_duration_ms` - Tool execution time
- `mcp_tool_call_errors_total` - Tool error count
- `memory_search_duration_ms` - Search performance
- `memory_search_results_count` - Result counts
- `db_query_duration_ms` - Database performance
- `active_sessions_count` - Concurrent sessions

**Example:**
```bash
curl http://localhost:3456/metrics
```

**Response format:** Prometheus text format

```
# HELP mcp_tool_call_duration_ms Tool call duration in milliseconds
# TYPE mcp_tool_call_duration_ms histogram
mcp_tool_call_duration_ms_bucket{tool="memory_search",le="10"} 45
mcp_tool_call_duration_ms_bucket{tool="memory_search",le="50"} 120
...
```

---

## MCP Protocol

### POST /mcp

MCP protocol endpoint for tool calls, resources, and prompts.

**Authentication:** Required (`X-API-Key` header)

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key
Accept: application/json, text/event-stream
```

**Request format:** JSON-RPC 2.0

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "memory_search",
    "arguments": {
      "query": "test"
    }
  }
}
```

**Response format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text",
      "text": "{...}"
    }]
  }
}
```

See [MCP Integration](../04-integration/mcp-integration.md) for details.

---

## trace_prep (Special Endpoint)

### POST /mcp/trace_prep

Preprocessing endpoint for universal workflow.

**Authentication:** Required (`X-API-Key` header)

**Purpose:** 
- Creates trace if missing
- Loads persona from trace
- Builds system prompt
- Returns scoped tools

**Request:**
```json
{
  "traceId": "trace-001",
  "sessionId": "telegram:123",
  "instructions": "Make AISMR video",
  "source": "telegram"
}
```

**Response:**
```json
{
  "traceId": "trace-001",
  "systemPrompt": "You are Iggy, the Creative Director...",
  "allowedTools": ["memory_search", "memory_store", "handoff_to_agent"],
  "instructions": "Generate 12 modifiers...",
  "memories": [...]
}
```

**Used by:** n8n universal workflow (not typically called directly)

---

## Version

### GET /version

Get service version information.

**Authentication:** None required

**Response:**
```json
{
  "version": "2.1.0",
  "commit": "abc123",
  "buildDate": "2025-01-09T12:00:00.000Z"
}
```

---

## Error Responses

All endpoints return consistent error format:

**4xx Client Errors:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid parameter: query",
    "details": {
      "field": "query",
      "issue": "Required field missing"
    }
  }
}
```

**5xx Server Errors:**
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Database connection failed",
    "requestId": "req-abc123"
  }
}
```

---

## Rate Limiting

**Default limits:**
- 100 requests per minute per API key
- 429 status code when exceeded

**Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704801600
```

**Configuration:**
```bash
# In .env
RATE_LIMIT_MAX=100
RATE_LIMIT_TIME_WINDOW=1 minute
```

---

## CORS

**Allowed origins:**
- Configured via `ALLOWED_ORIGINS` env var
- Comma-separated list
- Default: `http://localhost:5678,http://localhost:3000`

**Headers:**
```
Access-Control-Allow-Origin: https://yourdomain.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-API-Key
```

---

## Security Headers

Helmet security headers enabled:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

## Monitoring

### Health Check Monitoring

```bash
# Check every 30 seconds
watch -n 30 curl -s http://localhost:3456/health | jq .status
```

### Metrics Scraping

```yaml
# Prometheus config
scrape_configs:
  - job_name: 'mcp-server'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['mcp-vector.mjames.dev:443']
```

---

## Further Reading

- [MCP Integration](../04-integration/mcp-integration.md) - MCP protocol details
- [Observability](../05-operations/observability.md) - Monitoring
- [Deployment](../05-operations/deployment.md) - Production setup

