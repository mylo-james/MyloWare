# Infrastructure

This directory will absorb repository-wide infrastructure assets:

- `migrations/` (Alembic) and future schema tooling.
- `config/` (pydantic settings, defaults, validation).
- `security/` (auth helpers, webhook signatures, idempotency).
- `platform/` (Docker Compose, Fly.io manifests, cloudflared tunnels, observability assets).

During migration the existing `alembic/`, `infra/`, and `cloudflared/` directories stay in place.
Each step in `docs/migration-plan.md` references how and when those assets move into
`infrastructure/`.
