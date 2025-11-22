# Core Domain

`core/` houses pure domain models, policies, and helpers that have no I/O side effects.
When code moves from `libs/` or `api/` into this package, each module should be importable
without pulling in FastAPI, LangGraph, or provider adapters. Examples to land here:

- Run lifecycle + identifiers (`runs/model.py`, `runs/lifecycle.py`, `runs/identifiers.py`).
- Artifact metadata + lineage tracking.
- Persona registry, prompts, and guardrail policies.

Keeping these modules framework-free aligns with the OSS-first architecture described in
`NORTH_STAR.md` and the technology split in `techs.md`.

