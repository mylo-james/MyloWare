# Configuration and Environment (Python Stack)

**Audience:** Operators and developers  
**Outcome:** Know where configuration lives, which environment variables matter, and how to validate them.

---

## 1. Where configuration lives

The Python stack uses Pydantic `BaseSettings` classes for configuration:

- `apps/api/config.py` – FastAPI gateway (Brendan front door, runs API, webhooks).
- `apps/orchestrator/config.py` – LangGraph orchestrator (state graph and checkpoints).
- `apps/mcp_adapter/config.py` – optional MCP façade that forwards calls into the API/orchestrator.

Each service:
- Reads environment variables (and `.env`).
- Applies sane defaults for local development.
- Fails fast in production if required secrets are missing or still using dev defaults.

---

## 2. Core environment variables

### 2.1 Shared variables

| Env var | Service(s) | Purpose |
| --- | --- | --- |
| `API_KEY` | API, orchestrator, MCP adapter clients | Primary API key used by all callers (`x-api-key` header). |
| `DB_URL` / `db_url` | API, orchestrator | Postgres connection string (SQLAlchemy/psycopg). |
| `REDIS_URL` / `redis_url` | API | Redis cache / coordination (if enabled). |
| `LANGSMITH_API_KEY` | API, orchestrator | Enables LangSmith tracing. |
| `SENTRY_DSN` | API, orchestrator | Error reporting. |
| `OPENAI_API_KEY` | API, orchestrator | LLM access for personas + Brendan. |
| `TELEGRAM_BOT_TOKEN` | API | Telegram ingress. |

### 2.2 API-specific variables (`apps/api/config.py`)

| Env var | Purpose |
| --- | --- |
| `KIEAI_API_KEY` | Credentials for kie.ai. |
| `KIEAI_SIGNING_SECRET` | HMAC secret for kie.ai webhooks. |
| `SHOTSTACK_API_KEY` | Credentials for Shotstack. |
| `UPLOAD_POST_API_KEY` | Credentials for upload-post. |
| `UPLOAD_POST_SIGNING_SECRET` | HMAC secret for upload-post webhooks. |
| `HITL_SECRET` | Secret used to sign HITL approval links. |
| `MCP_BASE_URL` / `MCP_API_KEY` | Optional integration with an external MCP server. |
| `RAG_PERSONA_PROMPTS` | Toggle for RAG-enriched persona prompts. |

### 2.3 Orchestrator-specific variables (`apps/orchestrator/config.py`)

| Env var | Purpose |
| --- | --- |
| `ARTIFACT_SYNC_ENABLED` | Whether the orchestrator should sync artifacts back into the API. |
| `ENABLE_LANGCHAIN_PERSONAS` | Forces LangChain personas on/off. Defaults to **false** locally and **true** in staging/prod. Set to `true` when you want Riley/Alex/Quinn to call real tools during local runs. |

### 2.4 MCP adapter variables (`apps/mcp_adapter/config.py`)

| Env var | Purpose |
| --- | --- |
| `API_BASE_URL` | API URL used by the MCP adapter. |
| `ORCHESTRATOR_BASE_URL` | Orchestrator URL used by the MCP adapter. |
| `API_KEY` | API key sent in `x-api-key` header. |
| `HOST` / `PORT` | MCP adapter bind host/port (default `0.0.0.0:3000`). |
| `REQUEST_TIMEOUT_SECONDS` | HTTP timeout for MCP → API calls. |

---

## 3. Local development configuration

Typical `.env` snippet for local development:

```env
API_KEY=dev-local-api-key
DB_URL=postgresql+psycopg://postgres:postgres@localhost:5432/myloware
REDIS_URL=redis://localhost:6379/0

LANGSMITH_API_KEY=your-langsmith-key
SENTRY_DSN=

KIEAI_API_KEY=dev-kieai
KIEAI_SIGNING_SECRET=dev-kieai-signing-secret

SHOTSTACK_API_KEY=dev-shotstack

UPLOAD_POST_API_KEY=dev-upload-post
UPLOAD_POST_SIGNING_SECRET=dev-upload-post-signing-secret

HITL_SECRET=dev-hitl-secret
```

For Compose-based local runs, `make up` wires container hostnames and ports,
so you typically do not need to override URLs beyond what `.env.example`
provides.

### 3.1 Automatic environment detection

Both services infer their environment from `ENVIRONMENT` (if provided) or the
Fly app name (`myloware-api-staging`, `myloware-orchestrator-prod`, etc.). This
drives:

- `providers_mode` (`mock` locally, `live` on Fly)
- Public/orchestrator/webhook base URLs
- Upload-post domain selection (`.dev` in staging, `.com` elsewhere)
- `enable_langchain_personas` (on outside local)

You only need to set `ENVIRONMENT` manually when running outside Fly with
non-standard naming.

When running locally, LangChain personas are **off** by default. Flip them on by
setting `ENABLE_LANGCHAIN_PERSONAS=true` in `.env` (or exporting it in your shell)
before starting Docker Compose or `mw-py live-run`. In staging/production the
flag defaults to true, so Riley → Alex → Quinn will call real provider tools
unless you explicitly disable them.

---

## 4. Production safeguards

In production (detected from the Fly app name), the API and orchestrator enforce
stricter validation:

- Dev default values (`dev-local-api-key`, `dev-kieai`, etc.) are rejected.
- Secrets must be non-empty and meet minimum length requirements.

If a required secret is missing or still set to a development default, the
service raises an error at startup and fails fast. Fix the configuration and
redeploy rather than overriding the validation logic.

---

## 5. Validation workflow

### 5.1 Local / staging

```bash
cp .env.example .env     # or use env.development
mw-py validate env       # quick environment check

make up
docker compose -f infra/docker-compose.yml run --rm api alembic upgrade head
make test
make test-coverage
```

### 5.2 Production

- Keep `.env` files out of git.
- Use secrets manager + Fly secrets for all sensitive values.
- Make configuration changes via PRs that touch only code defaults or
  documented env var usage.

### 5.3 Persona gating quick check

Before running a pipeline that needs LangChain personas, run:

```bash
mw-py validate personas --project test_video_gen
```

The command inspects `ENABLE_LANGCHAIN_PERSONAS` (and the orchestrator settings
model if available) and warns when you're about to run a supported project with
personas disabled. Treat a warning as “observation-only mode” and flip the env
var to `true` before approving HITL gates.

---

## 6. Checklist

- [ ] `.env` (or equivalent secrets) present for each environment; only secrets live there now.
- [ ] `mw-py validate env` passes locally and in CI.
- [ ] `API_KEY` and provider secrets are non-default and rotated regularly.
- [ ] `HITL_SECRET` configured wherever HITL approvals are enabled.
- [ ] Services share consistent `LANGSMITH_*` values where tracing is required.
