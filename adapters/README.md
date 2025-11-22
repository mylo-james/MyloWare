# Adapters

All external integrations live under `adapters/`, matching the Ports & Adapters structure outlined
in `techs.md`:

- `ai_providers/` — kie.ai, Shotstack, and future providers (clients, mappers, webhooks, retries).
- `social/` — upload-post and publishing-related adapters.
- `persistence/` — database, cache, vector, and storage utilities (psycopg, Redis, pgvector).
- `observability/` — tracing, metrics, and Sentry wiring shared across apps.

Adapters may depend on third-party SDKs but must expose narrow interfaces for the `content/` and
`apps/` layers to call.

