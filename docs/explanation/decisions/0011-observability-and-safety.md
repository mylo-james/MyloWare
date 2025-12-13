# ADR-0011: Observability and Safety Defaults

## Status
Accepted — December 2025

## Context
- Safety shields are required for every agent turn; fail-open creates risk during render/publish.
- Previous env-based toggles created drift and “AI fodder” concerns.
- Limited tracing existed, making RCA on bad generations or render issues slower.

## Decision
- Hardcode safety defaults: shields on, fail-closed, canonical `content_safety` ID.
- Remove optional env toggles except essential infra keys.
- Add OTEL spans for safety middleware and Remotion tool; include timing middleware across API.
- Require sandbox + allowlist for `composition_code`; template mode stays default.
- Keep API-key auth as primary guard; OAuth intentionally omitted (covered in Known Limitations).

## Consequences
Positive:
- Consistent safety posture across environments.
- Easier debugging via spans and structured timing logs.
- Reduced configuration surface.

Negative:
- Less flexibility for rapid prototyping without safety (must change code if needed).
- Increased OTEL noise if backend collector is absent (acceptable; no-op when disabled).

## Alternatives Considered
- Keep env toggles for safety: rejected to avoid drift.
- Rely solely on keyword filter: rejected; insufficient coverage.

## References
- `src/api/middleware/safety.py` (shield + span)
- `src/tools/remotion.py` (render span)
- `docs/ENV.md`, `docs/RUNBOOK.md`
