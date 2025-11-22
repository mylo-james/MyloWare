# How to Add a Project

**Audience:** Developers adding new production types  
**Outcome:** New project type is available to Brendan and the orchestrator  
**Time:** 1–2 hours

---

## Overview

Projects define production types (AISMR, Test Video Gen, etc.). Each
project specifies:

- Persona workflow order.
- Production specs (counts, durations, formats).
- Quality guardrails.
- Optional steps and HITL points.

Project configuration lives under `data/projects/<slug>/` and is consumed by:

- The orchestrator when building the LangGraph state graph.
- Brendan when classifying and planning runs.

---

## Prerequisites

- Local Python stack running as described in `docs/README.md`.
- Relevant personas already exist under `data/personas/`.
- Tests green (`make test`) before you start.

---

## 1. Create project configuration

Create a directory at `data/projects/<slug>/` with at least:

```
data/projects/product-review/
├── project.json
├── workflow.json
├── guardrails/
└── expectations/
```

### 1.1 `project.json`

Example:

```json
{
  "name": "product-review",
  "title": "Product Review Videos",
  "description": "Multi-angle product review videos with commentary.",
  "workflow": [
    "brendan",
    "iggy",
    "riley",
    "alex",
    "quinn"
  ],
  "hitlPoints": ["before_quinn"],
  "optionalSteps": [],
  "specs": {
    "videoCount": 5,
    "videoDuration": 15.0,
    "compilationLength": 90,
    "aspectRatio": "9:16",
    "resolution": "1080x1920"
  },
  "settings": {
    "provider": "runway",
    "platforms": ["tiktok"]
  },
  "guardrails": {
    "summary": "Timing, visual, audio, and style constraints for product review videos.",
    "categories": ["timing", "visual", "audio", "style"]
  },
  "metadata": {
    "version": "1.0.0",
    "tags": ["project", "product-review"]
  },
  "links": {
    "personas": ["brendan", "iggy", "riley", "alex", "quinn"]
  }
}
```

**Key fields:**

- `name` – Project slug (lowercase, hyphenated).
- `workflow` – Persona pipeline order.
- `optionalSteps` – Personas that can be skipped.
- `hitlPoints` – Where HITL gates apply (e.g., `after_iggy`, `before_quinn`).
- `specs` – Concrete, testable production requirements.

### 1.2 `workflow.json`

Keeps the persona order explicit, including optional personas:

```json
{
  "workflow": ["brendan", "iggy", "riley", "alex", "quinn"]
}
```

### 1.3 Guardrails and expectations

Use `guardrails/` for JSON files that describe non‑negotiable rules (e.g.,
timing, visual, audio). Use `expectations/` for persona‑specific notes that
feed prompts.

Examples:

- `data/projects/product-review/guardrails/timing.runtime.json`
- `data/projects/product-review/expectations/iggy.json`

Keep guardrails concrete and easy to assert in tests.

---

## 2. Wire the project into the orchestrator

The orchestrator reads `data/projects/*` when building graphs. Ensure your
new project slug is supported in:

- `apps/orchestrator/graph_factory.py` – project → graph mapping.
- `apps/orchestrator/persona_nodes.py` – personas referenced in `workflow`.

Add or update unit tests under:

- `tests/unit/python_orchestrator/test_graph_factory.py`
- `tests/unit/python_orchestrator/test_<project>_graph.py` (if you create a dedicated test module)

Follow existing tests for `test_video_gen` and `aismr` as
patterns.

---

## 3. Make Brendan aware of the project

Brendan uses project metadata and classification logic to plan runs. Make
sure:

- The project slug and title appear in the classification prompt/logic.
- The `data/projects/<slug>/overview.json` (if present) matches the new
  specs and guardrails.

Add or update tests under:

- `tests/unit/python_orchestrator/test_brendan_graph_structure.py`
- `tests/unit/python_orchestrator/test_brendan_chat.py`

These tests should prove:

- Brendan proposes the correct pipeline (persona order + HITL gates).
- The orchestrator builds the expected graph for the new project.

---

## 4. Verify project ingestion

The Python CLI exposes a simple ingestion check:

```bash
mw-py ingest run --dry-run
```

This prints the personas, projects, and guardrails the system sees without
writing to the database. Fix any schema or path errors it reports.

If you rely on DB seeding for dashboards or admin tools, add a focused test
or script that reads `data/projects/*/project.json` and asserts that your
slug appears where expected.

---

## 5. End-to-end test

With the local stack running (`make up`) and `USE_MOCK_PROVIDERS=true`:

1. Start a run via Brendan:
   ```bash
   curl -sS -H "x-api-key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"user_id":"demo","message":"Make a product-review run for wireless headphones"}' \
     http://localhost:8080/v1/chat/brendan | jq .
   ```
2. Approve the workflow HITL gate if required.
3. Let the persona graph run to completion in mock mode.
4. Inspect the run in the database:
   ```sql
   SELECT run_id, project, status
   FROM runs
   WHERE project = 'product-review'
   ORDER BY created_at DESC
   LIMIT 5;
   ```
5. Inspect artifacts:
   ```sql
   SELECT type, provider, persona, created_at
   FROM artifacts
   WHERE project = 'product-review'
   ORDER BY created_at ASC;
   ```

Add or extend an integration test under
`tests/integration/python_api/test_test_video_gen_pipeline.py` or a new
module for your project that mirrors those patterns.

---

## Validation checklist

- [ ] `data/projects/<slug>/project.json` created and valid.
- [ ] `workflow.json` matches the intended persona pipeline.
- [ ] Guardrails and expectations are concrete and testable.
- [ ] Orchestrator graph factory supports the new project.
- [ ] Brendan classification and planning tests updated.
- [ ] `mw-py ingest run --dry-run` shows the project with no errors.
- [ ] A mocked end‑to‑end run completes via `/v1/chat/brendan`.

---

## Next steps

- [Add a Persona](add-a-persona.md) – Create new personas if your project needs them.
- [Run Integration Tests](run-integration-tests.md) – Verify orchestration flows.
- [Run State and Checkpoints](../02-architecture/trace-state-machine.md) – Understand how run state is persisted.
