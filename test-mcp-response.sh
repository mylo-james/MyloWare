#!/bin/bash
# Test what the MCP server actually returns

curl -s -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-agent" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: test-session-$(date +%s)" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "memory_search",
      "arguments": {
        "query": "test",
        "limit": 1
      }
    }
  }' | jq .
