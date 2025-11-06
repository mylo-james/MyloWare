#!/bin/bash
# Simulate how n8n's AI agent calls tools with plain strings

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
      "clientInfo": {"name": "n8n-test", "version": "1.0.0"}
    }
  }' | grep -i 'mcp-session-id' | cut -d' ' -f2 | tr -d '\r')

echo "Testing workflow_execute with plain string input (like n8n AI agent would send)..."
echo ""

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
      "name": "workflow_execute",
      "arguments": {
        "workflowId": "test-workflow",
        "input": "ASMR video about puppies"
      }
    }
  }' | jq '.result.content[0].text' | jq -r . | jq .

echo ""
echo "If you see clean JSON above (not an error), the fix worked!"
