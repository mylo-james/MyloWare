# How-To Guides

> ℹ️ **Python-first stack**
>
> These how-tos assume the Python CLI (`mw-py`) and the LangGraph-based services.

Task-oriented guides for common operations.

---

## Agent Development

- [Add a Persona](add-a-persona.md) - Create new agent roles
- [Add a Project](add-a-project.md) - Define new production types

## Knowledge Base

- [KB Ingestion (Manual)](kb-ingestion.md) - Load docs into pgvector

## Operations & Runbooks

- [Live Ops Runbook](runbook-live-ops.md) - Toggle live providers, resolve HITL issues, inspect traces

## Testing

- [Run Integration Tests](run-integration-tests.md) - Test coordination flows

## Deployment

- [Release Cut and Rollback](release-cut-and-rollback.md) - Safe deployments

---

## Quick Reference

### Common Tasks

**Add new agent:**
1. Create `data/personas/<name>/prompt.md` + metadata JSON.
2. Reference the persona in `data/projects/<project>/project.json`.
3. Update `apps/orchestrator/persona_nodes.py` with the agent configuration.
4. Run `pytest tests/unit/python_orchestrator/test_persona_nodes.py -k <persona>` (or wider suite) to confirm handoffs.

**Add new project:**
1. Create `data/projects/<slug>/project.json`.
2. Run `mw-py ingest run --dry-run` to validate structure.
3. Trigger Brendan with `curl /v1/chat/brendan` and confirm he classifies the new project.
4. Verify workflow progression in LangSmith + the `runs` table.

**Deploy to production:**
1. Tag release + push.
2. Backup database (`pg_dump` or managed snapshot).
3. Run Alembic migrations (`fly ssh console -C "alembic upgrade head"` or `docker compose run api alembic upgrade head`).
4. Deploy services (`fly deploy`, `make release`, etc.).
5. Verify `/health`, `/version`, and the Grafana “MyloWare Orchestration” dashboard. Refer to the [Live Ops Runbook](runbook-live-ops.md) for provider/HITL checks.

---

## Need More?

See [docs/README.md](../README.md) for complete documentation index.
