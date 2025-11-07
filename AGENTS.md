# AGENT PLAYBOOK

Welcome! This document is the single stop EM for AI (and human) agents working inside `mcp-prompts`. It captures how the repo is structured, how we expect you to develop, test, document, and hand off work.

---

## 1. Mission Snapshot

- **Product:** Multi-agent, memory-first “AI Production Studio”.
- **North Star:** Every production run is coordinated via `traceId` (Epic 1) and completed through persona-specific n8n workflows (Epics 2+).
- **Reality Check (Nov 7 2025):** Epic 1 tooling is live; docs + legacy-tool cleanup + Story 2.1 are next.

Keep your work tied to `plan.md` (always in the root tab). Stories only close when their Definition of Done items are checked.

---

## 2. Repo Map

| Path/Asset | Why You Care |
| --- | --- |
| `src/mcp/tools.ts` | All MCP tools (trace + memory + workflow). Adding/updating tools goes here. |
| `src/db/schema.ts` / `drizzle/` | Source of truth for Postgres tables + migrations. |
| `src/db/repositories/` | Drizzle repositories; tests live under `tests/unit/db/repositories`. |
| `docs/` | Canonical documentation. If it isn’t in `docs/`, it doesn’t exist. |
| `plan.md` | Implementation contract. Work in story order unless told otherwise. |
| `tests/` | Vitest suites (`unit`, `integration`, `e2e`). See §4. |
| `scripts/` | Helpers for seeding, workflow import, etc. |

---

## 3. Local Development

### Prereqs

- Node 18+ (we test on Node 20/22).
- Docker (Colima or Docker Desktop) if you want to use the disposable Postgres harness (recommended).
- `npm install` at repo root.

### Environment

1. Copy `.env.example` → `.env` (or reuse `.env` already in repo) and set:
   - `OPENAI_API_KEY`
   - `MCP_AUTH_KEY`
   - `N8N_*` vars (see `docs/n8n-webhook-config.md`)
   - `DB_PASSWORD`, etc.
2. Run `npm run db:bootstrap -- --seed` if you’re using the Docker compose dev stack (`npm run dev:docker` spins it up).

### Running the MCP server

- **Hot reload (host machine):** `npm run dev` (Fastify on `http://localhost:3456`).
- **Docker dev stack:** `npm run dev:docker` (see `docker-compose.yml`); `npm run dev:stop` to tear down.
- **Standalone n8n:** Provided in compose (`n8n` service). Credentials live in `.env`.

### Bringing things up/down fast

```bash
# Install deps
npm install

# Start MCP server locally
npm run dev:local

# Start the full Docker profile (postgres, n8n, dev server)
npm run dev:docker

# Stop containers
npm run dev:stop
```

---

## 4. Database & Test Harness

We default to a disposable Postgres container so agents don’t fight over ports.

- **Unit test baseline (CI + local):**

  ```bash
  TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit
  ```

  `tests/setup/env.ts` auto-detects Colima/Docker Desktop sockets and rewrites `DOCKER_HOST`. It also clears `.env`’s `POSTGRES_PORT` so Drizzle won’t stomp on the ephemeral port.

- **What happens under the hood:**
  1. `tests/setup/database.ts` starts `pgvector/pgvector:pg16`, captures the mapped port, runs migrations (`npx drizzle-kit push`), seeds base data, and calls `resetDbClient()` so all Drizzle repositories point at the disposable database.
  2. After tests finish, the container stops automatically.

- **Reusable local DB option:** Export `TEST_DB_URL` (see `DEV_GUIDE.md`) and run `npm run test:unit:local`. Only do this if you already have a dedicated Postgres instance at `127.0.0.1:6543`.

---

## 5. Testing Strategy

| Scope | Command | Notes |
| --- | --- | --- |
| All unit suites | `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit` | 154 tests / 26 files as of Nov 7 2025. |
| Targeted unit | `npx vitest run <path>` | e.g., `tests/unit/mcp/trace-tools.test.ts`. |
| Integration (trace flow) | `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/integration/trace-coordination.test.ts` | Ensures `trace_create → handoff → workflow_complete` path works. |
| Coverage | `npm run test:coverage` | Uses Vitest + V8. |

CI blocks require unit tests + lint/type-check once we wire them in; run them locally before handoff.

---

## 6. Documentation Policy & Context7

- **Docs live in `docs/`.** If you change behavior, update or create a doc there (e.g., `docs/ARCHITECTURE.md`, `docs/n8n-webhook-config.md`). We prefer smaller, task-focused Markdown files rather than monoliths.
- **AGENT behavior:** When you respond via Context7 (OpenAI’s doc retrieval API), prefer documents from `docs/` first. Keep them fresh; stale docs degrade autonomous agents quickly.
- **Plan vs. docs:** `plan.md` drives execution order. `docs/` explains architecture/integration. Update both when scope or design shifts.

---

## 7. Tooling & Workflows to Remember

- **Trace tools:** `trace_create`, `handoff_to_agent`, `workflow_complete` live in `src/mcp/tools.ts`. They touch `execution_traces` + `agent_webhooks`.
- **n8n integration:** Use `handoff_to_agent` to trigger persona webhooks. All secrets stay in env vars; `agent_webhooks` only stores metadata.
- **Memory discipline:** Always tag stored memories with `traceId`, `persona`, `project`. The entire coordination layer depends on memory searchability.
- **Context repos:** `tests/unit/tools/workflow/executeTool.test.ts` & `.../getStatusTool.test.ts` show how registry lookups + n8n delegations should behave.
- **Clarifications & prompt discovery:** Telegram HITL nodes now handle clarifications, and procedural memories + `memory_search` replace `prompt_discover`. The `clarify_ask` and `prompt_discover` tools were removed on Nov 7 2025—don’t reference them in new work.

---

## 8. Handoff Checklist

Before you claim a story “done”:

1. `plan.md` checkboxes for that story are updated.
2. Docs in `docs/` reflect the new behavior.
3. `TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npx vitest run tests/unit` passes (paste or summarize results in your final note).
4. Mention follow-on work (bugs, docs debt, next story prerequisites).

Happy building! Stay trace-aware, keep memory clean, and document as you go. Everything else follows. ***
