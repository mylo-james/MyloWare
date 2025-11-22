# How to Add a Persona

**Audience:** Developers adding new agent roles  
**Outcome:** New persona integrated into the pipeline  
**Time:** 30-60 minutes

---

## Overview

Personas are autonomous agents with specific roles in the production pipeline. Adding a new persona requires:
1. Creating persona configuration JSON
2. Registering webhook
3. Testing handoff chain

---

## Prerequisites

- Local Python stack running as described in [docs/README.md](../README.md)
- Familiarity with the current persona pipelines in `apps/orchestrator/persona_nodes.py`

---

## Steps

### 1. Define persona prompts and metadata

Create a new persona directory under `data/personas/<name>/` with at least:
- `prompt.md` – the core instructions for the persona
- Optional JSON/metadata files for guardrails or defaults

Example `data/personas/morgan/prompt.md`:

```markdown
You are Morgan, the sound designer in the AISMR pipeline.

Your responsibilities:
- Take generated video clips and add audio layers (music + effects).
- Respect project guardrails for loudness, genre, and duration.
- Hand off enriched clips to the editor persona.
```

Keep prompts short and concrete. Avoid marketing language; focus on the job the persona actually does in the pipeline.

### 2. Wire the persona into the project graph

Update the relevant project spec in `data/projects/<project>/project.json` to include your new persona in the `workflow` sequence and, if applicable, in any HITL gate configuration:

```json
{
  "slug": "aismr",
  "workflow": ["brendan", "iggy", "riley", "morgan", "alex", "quinn"],
  "hitlPoints": ["after_iggy", "before_quinn"],
  "optionalSteps": ["morgan"]
}
```

This file is what `apps/orchestrator/graph_factory.py` uses when building the per-project LangGraph state graph.

### 3. Implement the persona node

Add a node implementation to `apps/orchestrator/persona_nodes.py`. Follow the existing patterns for Iggy/Riley/Alex/Quinn:
- Accept a `RunState` input
- Call the appropriate tools/adapters (retrieval, kie.ai, Shotstack, upload-post, etc.)
- Emit structured artifacts via the artifact helpers
- Update the run state (`videos`, `stage`, `awaiting_gate`, etc.)

The goal is for each persona node to be:
- Deterministic under mocks
- Strict about guardrails
- Clear about when and how it hands off to the next persona

### 4. Add tests for the new persona

Add unit tests that exercise the persona node in isolation:
- For pure logic, put tests under `tests/unit/python_orchestrator/test_persona_nodes_<name>.py`
- For API-facing behavior, add tests under `tests/unit/python_api` if the persona interacts with routes or services

Use the existing persona tests as templates and ensure:
- Happy-path behavior is covered
- Guardrails are enforced (e.g., invalid inputs raise)
- Any external adapters are mocked so tests do not hit real providers

### 5. Run the pipeline end-to-end in mock mode

With the local stack running (`make up`) and `USE_MOCK_PROVIDERS=true`, run:

```bash
pytest tests/unit/python_orchestrator -k morgan -q
pytest tests/integration/python_api/test_test_video_gen_pipeline.py -q
```

Then start a run via Brendan:

```bash
curl -sS -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo","message":"Make an AISMR run that uses the sound designer"}' \
  http://localhost:8080/v1/chat/brendan
```

Approve gates as needed and confirm:
- The new persona appears in the run state (`/v1/runs/{runId}`)
- Artifacts created by the persona look correct

---

## Validation

- Persona prompt and metadata exist under `data/personas/`
- Project workflow includes the new persona and still matches the intended pipeline
- Persona node is implemented in `apps/orchestrator/persona_nodes.py`
- Unit tests pass for the new persona
- A full mocked pipeline run exercises the persona end-to-end

---

## Next Steps

- [Add a Project](add-a-project.md) – Create new production types
- [Run Integration Tests](run-integration-tests.md) – Test coordination
