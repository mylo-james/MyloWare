# MCP Prompt Vector Server

Self-hosted Model Context Protocol (MCP) server that indexes n8n prompts in PostgreSQL + pgvector and exposes semantic/metadata tools over HTTP or Cloudflare Tunnel.

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 16 with `vector` extension
- Cloudflare account with existing zone (for tunnel + DNS)
- `cloudflared` CLI installed locally

## Installation

```bash
npm install
npm run db:migrate
npm run db:operations:migrate    # create runs/videos tables (optional but recommended)
```

Copy `.env.example` (if present) or set the required environment variables (`DATABASE_URL`, `OPENAI_API_KEY`, etc.). Defaults live in `src/config/index.ts`.

### Operations Database (Runs & Videos)

Set `OPERATIONS_DATABASE_URL` to a PostgreSQL connection string (e.g. Supabase) when you want the MCP server to surface workflow runs and generated videos. The schema migrations live in `drizzle-operations/`; apply them with `npm run db:operations:migrate`. When the variable is unset the operational tools are disabled, but the prompt vector store continues to work normally.

## Developing

```bash
npm run dev           # start Fastify HTTP transport (localhost:3456 by default)
npm test              # run Vitest suite
npm run lint          # eslint
npm run scan:prompts  # preview prompt metadata
```

## Cloudflare Tunnel

The repository ships with a tunnel configuration (`cloudflared/config.prompts.yml`) that expects a tunnel named `mcp-vector` exposing the local server at `http://localhost:3456`.

### 1. Authenticate cloudflared

```bash
cloudflared tunnel login
cp ~/.cloudflared/cert.pem cloudflared/cert.pem
```

### 2. Generate tunnel credentials

```bash
npm run tunnel:credentials
```

This wraps `cloudflared tunnel create mcp-vector`, parses the credential path output by the CLI, and copies the JSON into `cloudflared/credentials/mcp-vector.json`. Use `npm run tunnel:credentials -- --force` to regenerate after deleting the existing file.

If the script cannot locate the credential path automatically, copy the tunnel JSON from `~/.cloudflared/` into the credentials directory manually.

### 3. Configure DNS

Map your hostname (e.g. `mcp-vector.mjames.dev`) to the tunnel:

```bash
cloudflared tunnel route dns mcp-vector mcp-vector.mjames.dev
```

Confirm the route is active:

```bash
cloudflared tunnel info mcp-vector
```

### 4. Run the tunnel

```bash
npm run tunnel
```

The script validates the config, credentials, and origin certificate before launching `cloudflared tunnel run` with the project configuration.

## HTTP Transport Configuration

Environment variables for the HTTP transport (defaults shown):

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `SERVER_HOST` | Bind host for Fastify server | `0.0.0.0` |
| `SERVER_PORT` | Bind port | `3456` |
| `HTTP_RATE_LIMIT_MAX` | Requests per IP per window | `100` |
| `HTTP_RATE_LIMIT_WINDOW_MS` | Rate-limit window (ms) | `60000` |
| `HTTP_REQUEST_TIMEOUT_MS` | Request timeout for non-SSE requests | `15000` |
| `HTTP_ALLOWED_ORIGINS` | Comma-separated list of allowed `Origin` values (empty = allow all) | _(empty)_ |
| `HTTP_ALLOWED_HOSTS` | Comma-separated list of allowed `Host` headers for MCP transport | _(empty)_ |
| `MCP_API_KEY` | API key required in the `X-API-Key` header (unset disables auth) | _(unset)_ |

Set `DEBUG_MCP_HTTP=true` to log normalized Accept headers while troubleshooting Cloudflare proxy behaviour.

### Authentication

When `MCP_API_KEY` is set, every request to `/mcp` must include `X-API-Key: <value>`. Requests with missing or mismatched keys are rejected with HTTP 401 and the attempt is logged. Combine this with `HTTP_ALLOWED_ORIGINS` (CORS + origin validation) and `HTTP_ALLOWED_HOSTS` (transport-level host allowlist) for stricter perimeter security.

## Deploying

1. Run `npm run build`.
2. Launch PostgreSQL + app stack (e.g. via `docker-compose.yml`).
3. Start the tunnel (`npm run tunnel`) on the host or within the orchestrated stack.
4. Verify health:
   - `GET /health` → `{ "status": "ok" }`
   - `GET /mcp` with `Accept: text/event-stream` to observe SSE stream.
   - MCP resources: `prompt://info`, `status://health`.

## Additional Resources

- [PLAN.md](../PLAN.md) tracks project milestones.
- `docs/` contains migration and prompt transformation notes.
