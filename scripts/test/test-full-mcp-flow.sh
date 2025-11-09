#!/bin/bash
# Initialize session first, then call a tool

SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

echo "=== Step 1: Initialize Session ==="
INIT_RESPONSE=$(curl -s -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-agent" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }')

echo "$INIT_RESPONSE" | jq .
SESSION_ID=$(echo "$INIT_RESPONSE" | jq -r '.result.sessionId // empty')

if [ -z "$SESSION_ID" ]; then
  # Extract from response header
  SESSION_ID=$(curl -s -i -X POST http://localhost:3456/mcp \
    -H "Content-Type: application/json" \
    -H "X-API-Key: mylo-mcp-agent" \
    -H "Accept: application/json, text/event-stream" \
    -d '{
      "jsonrpc": "2.0",
      "id": 1,
      "method": "initialize",
      "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
          "name": "test-client",
          "version": "1.0.0"
        }
      }
    }' | grep -i 'mcp-session-id' | cut -d' ' -f2 | tr -d '\r')
fi

echo ""
echo "Session ID: $SESSION_ID"
echo ""
echo "=== Step 2: Call Tool ===" 
curl -s -X POST http://localhost:3456/mcp \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-agent" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "memory_search",
      "arguments": {
        "query": "test",
        "limit": 1
      }
    }
  }' | jq .


