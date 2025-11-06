# n8n MCP Authentication Fix

## Problem
n8n credentials drifted between V1 and V2. Some guides instructed using `Authorization: Bearer <key>`, others `X-MCP-Auth-Key`. The MCP server now enforces a **single** authentication mechanism: the `x-api-key` header. Any workflow or credential that still uses the Bearer format fails with a 401, which looks like a 502 timeout when triggered through Cloudflare.

## Solution
Always configure the n8n MCP credential with a single custom header:

| Field | Value |
| --- | --- |
| Credential name | `Mylo MCP` (or similar) |
| Header name | `x-api-key` |
| Header value | `<value of MCP_AUTH_KEY in .env>` |

### 1. Update the n8n credential
1. Open **Credentials → Mylo MCP**.
2. Set **Header Name** to `x-api-key`.
3. Set **Header Value** to the exact string from your `.env` (`MCP_AUTH_KEY=...`).
4. Save and run the credential test (n8n sends a GET with the same header).

### 2. Verify from the CLI
```bash
curl -X POST https://mcp-vector.mjames.dev/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $MCP_AUTH_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

You should see the list of MCP tools. If you get `Unauthorized`, double-check the header casing and that the key matches `.env`.

### 3. Redeploy / restart if needed
The Fastify server only inspects `x-api-key`. No Bearer tokens or alternate header names are honored, so once every credential is updated you are guaranteed a consistent handshake across environments.

## Notes
- The Cloudflare tunnel and n8n cloud both send a GET/OPTIONS probe before POSTing; these now expect the same `x-api-key`.
- Never store the key inside workflows. Keep it in credentials so it can be rotated centrally.
