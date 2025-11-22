# Security Audit Playbook

**Audience:** Maintainer running a periodic security review  
**Outcome:** Clear, repeatable checklist for dependency scanning, input validation, auth, infra checks, and secrets rotation.

---

## 1. Dependency Scanning

Run Python dependency audit locally:

```bash
make security
```

This target runs `pip-audit` against the active environment. Treat **high‑severity** findings as blockers for production deployments.

Suggested workflow:

1. Ensure your virtualenv is up to date:
   ```bash
   pip install -e .[dev]
   ```
2. Run the security scan:
   ```bash
   make security
   ```
3. For each reported vulnerability:
   - Prefer upgrading to a non‑vulnerable version.
   - If an upgrade is not yet available, document the CVE and mitigation in the PR and link to upstream issues.

In CI, `make security` should run on the main branch and on PRs touching dependencies. High‑severity findings should fail the build.

---

## 2. Input Validation & Auth

When auditing input handling:

- Verify FastAPI routes use pydantic models with:
  - Bounded string lengths (`min_length`, `max_length`).
  - Explicit enums for known values (e.g., `project` names, `environment`).
- Confirm API authentication:
  - All non‑health endpoints require `x-api-key` except explicitly exempt endpoints (docs, metrics, health, webhooks).
  - Rate limiting is enforced for `/v1/chat/brendan`, `/v1/runs/start`, and `/v1/hitl/approve`.
- Check webhook routes:
  - Signatures are verified (HMAC with shared secret).
  - Idempotency is enforced using a stable idempotency key.
  - Malformed payloads return 4xx and do not mutate state.

During the audit, capture at least one example request/response for:

- `/v1/chat/brendan`
- `/v1/runs/start`
- `/v1/webhooks/*`

and ensure they match the documented contract in `docs/architecture.md` and the PRD.

---

## 3. Infrastructure & Network (SSRF + Egress)

For outbound HTTP:

- Confirm all external calls go through typed adapters (kie.ai, Shotstack, upload‑post, FFmpeg normalizer) rather than ad‑hoc `httpx` usage.
- Verify host allowlists:
  - Only known providers (e.g. `api.kie.ai`, `api.shotstack.io`, `api.upload-post.com`, `cdn.myloware.com`) are allowed in non‑local environments.
  - `.test`, `.example`, `localhost`, and private IP ranges are rejected automatically outside the `local` environment (Fly apps run in restricted mode by default).
- Ensure HTTP clients:
  - Have explicit timeouts configured.
  - Are not used to stream unbounded responses into memory.

Infra checks:

- Confirm egress is restricted at the network layer to known providers where possible.
- Verify that database, Redis, and telemetry endpoints are not reachable from untrusted networks.

---

## 4. Secrets Management & Rotation

Policy:

- All production and staging secrets are stored in the password manager (e.g. 1Password) and injected via Fly.io secrets.
- No secrets are committed to the repository (including `.env.example`).
- Secrets are rotated at least quarterly, or immediately after an incident.

Checklist:

1. Enumerate all secrets used by `apps/api` and `apps/orchestrator`:
   - `API_KEY`, `DB_URL`, `HITL_SECRET`
   - Provider keys: `KIEAI_API_KEY`, `KIEAI_SIGNING_SECRET`, `SHOTSTACK_API_KEY`, `UPLOAD_POST_API_KEY`, `UPLOAD_POST_SIGNING_SECRET`
   - Observability: `SENTRY_DSN`, `LANGSMITH_API_KEY`
2. Confirm that:
   - Production/staging values are **not** default dev values.
   - All secrets meet minimum length requirements (≥12 characters).
   - `HITL_SECRET` is set in staging/prod and not reused across environments.
3. Record rotation actions:
   - Date of last rotation.
   - Operator performing the rotation.
   - Scope (which envs, which keys).

---

## 5. Audit Outcomes & Follow‑ups

After each security audit:

- File issues for any gaps found (tracking CVEs, missing validation, or infra work).
- Update this document with:
  - New checks that should be part of every audit.
  - Retired checks that are now enforced automatically by CI or infra.

Aim to keep the audit lightweight enough to run in under an hour, while covering all critical paths (chat ingress, runs, webhooks, providers, and secrets).
