## Dev Workflow Helpers

- ### MCP Handshake Quick Test
  - `curl http://localhost:3456/mcp -H "X-API-Key: $MCP_AUTH_KEY" -H "Content-Type: application/json" -H "Accept: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}'`
  - Server fills in default `clientInfo`, augments `Accept` with `text/event-stream`, and returns `Mcp-Session-Id` header on success.
  - Subsequent requests MUST include the returned `Mcp-Session-Id` header and `Mcp-Protocol-Version`.
  - SSE stream: `curl -H "Accept: text/event-stream" -H "Mcp-Session-Id: <id>" -H "X-API-Key: $MCP_AUTH_KEY" http://localhost:3456/mcp`
These helpers speed up the inner loop when iterating on n8n + MCP workflows locally.

### Quick Commands

| Command | Description |
| --- | --- |
| `npm run workflow:dev:refresh` | Re-imports `workflows/*.workflow.json` into the dev n8n instance and re-activates everything. |
| `npm run workflow:dev:watch` | Watches the `workflows/` directory – when a file changes the refresh command is auto-run. |
| `npm run workflow:dev:summary` | Prints MCP/n8n health, workflow IDs + activation state, and credential IDs from Postgres. |
| `npm run workflow:test -- "..."` | Manually trigger the Casey webhook with custom instructions. |
| `npm run workflow:test -- --fixture <name>` | Use one of the canned fixtures defined in `tests/e2e/fixtures/workflow-fixtures.json`. |
| `npm run workflow:test -- --list-fixtures` | Display all available fixtures. |
| `npm run watch:execution` | Stream the most recent n8n execution (agent node + tool logs) in real time. |
| `npm run watch:execution -- <executionId>` | Tail a specific execution if you already know the ID. |
| `npm run dev:obs [<executionId>]` | Start an observation session: tails n8n logs and runs `watch:execution` (optionally for a specific execution). |

### Typical Inner Loop

```bash
# 1. Start services (postgres + n8n)
npm run dev:services:start

# 2. Keep workflows in sync while editing JSON locally
npm run workflow:dev:watch

# 3. In another terminal, run MCP with hot reload
npm run dev

# 4. Trigger a manual test when ready
npm run workflow:test -- --fixture test-video-run
```

### Notes

- The watcher debounces changes and will queue a sync if you save multiple files quickly.
- `workflow:dev:summary` is useful after a clean bootstrap to grab credential IDs without opening psql.
- Fixtures are plain JSON, easy to extend for new manual test scenarios.
- To make `npm run dev:obs` useful, enable n8n file logging (`N8N_LOG_OUTPUT=console,file`, `N8N_LOG_FILE_LOCATION=/home/node/.n8n/logs/n8n.log`) and optionally bind the logs directory to your host.

