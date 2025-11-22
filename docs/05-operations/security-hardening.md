# Security Hardening Guide (Python Stack)

**Last Updated:** 2025-11-14  
**Version:** 2.0

---

## Overview

This guide covers hardening the Python MyloWare stack in production:
FastAPI API, LangGraph orchestrator, optional MCP adapter, and Postgres.

The goals:
- Protect the API and HITL surfaces.
- Keep provider/webhook secrets safe.
- Reduce blast radius for incidents.

---

## 1. Authentication and authorization

### 1.1 API key enforcement

The FastAPI service requires an `x-api-key` header for all non-public
endpoints. The key comes from `API_KEY` / `api_key` in `apps/api/config.py`.

**Recommendations**
- Use a long, random value (≥ 32 chars) in production.
- Store the value only in your secrets manager and Fly secrets.
- Rotate the key on a regular cadence (e.g., 90 days) and update all clients.

All human and automation entry points (Brendan chat, CLI, MCP adapter,
Telegram bridge) should use this API key and call `/v1/chat/brendan`
instead of internal orchestration endpoints.

### 1.2 HITL approval signing

HITL links (workflow, ideate, prepublish) are signed using `HITL_SECRET`.

**Recommendations**
- Set `HITL_SECRET` in each environment; never reuse dev secrets in prod.
- Keep the secret long and random (≥ 32 chars).
- Rotate by:
  1. Adding the new secret alongside the old in a dual-validate mode (if implemented).
  2. Updating all environments.
  3. Dropping the old secret after outstanding links expire.

If you change `HITL_SECRET`, treat existing approval links as invalid.

---

## 2. Provider and webhook security

### 2.1 HMAC signing for providers

Provider webhooks must be signed and validated. Environment variables:

- `KIEAI_SIGNING_SECRET`
- `UPLOAD_POST_SIGNING_SECRET`

**Controls**
- Reject any webhook whose signature fails validation.
- Record `signature_status` in `webhook_events` for auditing.
- Use idempotency keys (e.g., `X-Request-Id`) to deduplicate events.

### 2.2 Rate limiting and retries

Use retries with backoff for provider APIs and guard against abuse:

- Implement exponential backoff in adapters (already configured for providers).
- Add rate limiting at the edge (Fly, reverse proxy, or API gateway).

Monitor:
- `webhook_events_total{status="failed"}`.
- Provider latency histograms (`kieai_job_seconds`, `shotstack_render_seconds`, `upload_post_seconds`).

---

## 3. Network and TLS

### 3.1 Network boundaries

- Keep Postgres and Redis in a private network where possible.
- Restrict inbound traffic to the API and orchestrator via Fly org config
  or a reverse proxy (Cloudflare, nginx, etc.).
- Do not expose internal services (Postgres, Redis) directly to the public internet.

### 3.2 TLS

Terminate TLS at your edge (Fly, Cloudflare, or an nginx ingress) with:

- TLS ≥ 1.2 (prefer 1.3).
- Strong cipher suites.
- HSTS enabled for primary domains.

Example nginx snippet:

```nginx
ssl_protocols TLSv1.3;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
add_header Strict-Transport-Security "max-age=63072000" always;
```

---

## 4. Secrets management

### 4.1 Where secrets live

- Local: `.env` (never committed), populated from 1Password or equivalent.
- Staging/Prod: secrets store (Fly secrets, Vault, AWS Secrets Manager, etc.).

**Never**:
- Check secrets into git.
- Paste secrets into tickets or chat systems.

### 4.2 Rotation procedures

Rotate these regularly:

- `API_KEY`
- `HITL_SECRET`
- Provider API keys (`KIEAI_API_KEY`, `SHOTSTACK_API_KEY`, `UPLOAD_POST_API_KEY`)
- Provider signing secrets (`KIEAI_SIGNING_SECRET`, `UPLOAD_POST_SIGNING_SECRET`)

Typical rotation flow:
1. Create new secret in secrets manager.
2. Update environment configuration.
3. Restart services.
4. Verify health checks, smoke tests, and live runs.

---

## 5. Least privilege

### 5.1 Service separation

- API:
  - Public entry point, validates requests, records runs and artifacts.
- Orchestrator:
  - Internal-only; executes LangGraph graphs and updates checkpoints.
- MCP adapter (optional):
  - Thin façade; only needs to reach API and orchestrator.

Use separate credentials for each service where possible.

### 5.2 Persona tool allowlists

Persona nodes run with least-privilege tool access:

- Keep tool lists minimal for each persona.
- For new tools, start with limited exposure (one persona, one project) and
  expand only after validation.

---

## 6. Logging and PII

### 6.1 Log hygiene

- Log `run_id`, `request_id`, and high-level events.
- Avoid logging raw request bodies, provider payloads, or secrets.
- Use structured logging so sensitive fields can be redacted centrally.

### 6.2 Telemetry

- Use Sentry for exception capture.
- Use LangSmith for workflow tracing and Prometheus/Grafana for metrics.
- For privacy-sensitive environments, adjust sampling and log content so
  personal data does not leak into third-party systems.

---

## 7. Compliance quick audit

- [ ] `API_KEY` and provider secrets are set via a secrets manager.
- [ ] `HITL_SECRET` configured in all environments; approval links are signed.
- [ ] TLS configured and enforced at the edge.
- [ ] Postgres and Redis are not publicly exposed.
- [ ] Webhook signatures are validated and recorded.
- [ ] Logs do not contain secrets or raw payloads.
- [ ] Regular backups are configured and tested (see `backups-and-restore.md`).
- [ ] Incident runbooks (this and `production-runbook.md`) are up to date.
