# Plan (GPT-5 Codex)

## Context Snapshot
- Epic 1 trace coordination work is nominally live, but the codebase still reflects legacy multi-workflow scaffolding (`agent_runs`, `handoff_tasks`, `run_events`, scattered webhook configs).
- The universal `myloware-agent.workflow.json` exists, yet supporting infrastructure (trace schema, tools, persona/project configs, tests, docs) is only partially aligned and `docs/PLAN.md` has diverged from the North Star vision.
- `execution_traces` currently lacks ownership/instruction columns; `projects` still uses legacy `workflows` JSON; persona metadata does not enforce least-privilege tool scopes.

## Guiding Principles (anchor to NORTH_STAR.md)
- Treat the trace as the single source of truth for ownership, workflow position, instructions, and completion state.
- Operate one polymorphic n8n workflow that becomes any persona by querying the trace + configuration via a single `trace_prep` preprocessor.
- Ensure every handoff is a state transition (`handoff_to_agent`) tagged with the active `traceId`, with special `complete`/`error` terminals.
- Keep personas/project behavior declarative: configuration drives instructions; agents remain stateless and discover their role at runtime.
- Uphold memory discipline (always tag `traceId`, `project`, `persona`) and HITL checkpoints called out in the North Star runbook.

## Phase Roadmap

### Phase 0 – Baseline Assessment & Guardrails
- Inventory existing workflows, MCP tools, and database migrations; flag any live automation depending on legacy tables/tool names.
- Freeze additional drift by documenting interim behavior and enabling the legacy tool guard (CI `npm run check:legacy-tools`).
- Confirm working test harness (containerized Vitest) and ensure we can reproduce current coverage locally.

-### Phase 1 – Trace Schema & Tool Uplift
- Extend `execution_traces` with `current_owner`, `previous_owner`, `instructions`, `workflow_step`, `status`, `outputs`, `metadata`, timestamps; retain UUID `traceId` storage while providing formatting helpers if human-readable IDs are needed externally.
- Remove legacy orchestrator tables (`agent_runs`, `handoff_tasks`, `run_events`) once migrations land—no production systems depend on them.
- Update MCP trace tools:
  - `trace_create` to initialize traces with default owner `casey`, `workflow_step = 0`, `status = active`.
  - `trace_update` for Casey and future corrective actions.
  - Standardize on `trace_prepare` as the single preprocessing endpoint that consolidates persona/project lookup, memory rollup, prompt build, and allowed tool lists per the North Star design.
- Implement web-safe migration/rollback scripts and seed data updates.

-### Phase 2 – Projects & Personas as Configuration
- Normalize `projects` schema to match North Star (`workflow` array representing the single persona pipeline per project, plus `optional_steps`, `specs`, `guardrails`, `hitlPoints`).
- Seed AISMR and GenReact entries exactly as specified; document pattern for additional projects.
- Update persona records with minimum required tool lists, prompts, tone, metadata for trace-aware execution.
- Build validation utilities/tests to ensure every project references valid personas and optional steps are subsets of the base workflow.

### Phase 3 – Single Workflow Enablement
- Refactor `myloware-agent.workflow.json` to the three-node pattern (Edit Fields → `trace_prepare` HTTP → AI Agent) with dynamic tool inclusion and hard-coded MCP endpoint as required by n8n Cloud.
- Ensure triggers (Telegram, chat, webhook) correctly forward `traceId`, `sessionId`, and raw instructions into `trace_prep`.
- Wire Casey’s kickoff flow (project discovery → memory_store → handoff) without the legacy wait/poll loop; the final agent (currently Quinn) owns user-facing completion summaries.
- Decommission archived per-persona workflows and update deployment docs to point at the universal workflow.

### Phase 4 – Agent Behaviors & External Integrations
- Align each persona’s responsibilities with `NORTH_STAR.md` examples (Iggy uniqueness check, Riley validation, Veo external video API orchestration, Alex editing, Quinn publishing) through tool usage and prompt content.
- Implement deterministic sub-flows (e.g., Veo’s polling/job orchestration) using n8n wait or loop nodes so AI steps remain non-blocking.
- Add HITL approval nodes at the documented checkpoints (after modifiers, before upload) with resume handling.

### Phase 5 – Testing & Observability
- Expand unit tests for MCP tools (`trace_prepare`, trace transitions, special handoffs, memory tagging) with coverage ≥ North Star floor.
- Add integration tests for: Casey initialization (unknown project), full AISMR happy path, GenReact optional-step skip, error recovery loop (Veo → Riley).
- Instrument trace and memory repositories with logging/metrics to support “workflow progress” queries outlined in North Star.
- Provide runbooks for monitoring active traces, identifying stuck workflows, and replaying memories.

### Phase 6 – Documentation & Rollout
- Replace `docs/PLAN.md` with this phased roadmap once validated; update `ARCHITECTURE.md`, `MCP_TOOLS.md`, `docs/MCP_PROMPT_NOTES.md`, and add `TRACE_STATE_MACHINE.md`/`UNIVERSAL_WORKFLOW.md` per checklist.
- Publish migration guide (V1 multi-workflow → V2 universal workflow) covering schema changes, workflow deployment, and rollback.
- Coordinate rollout: migrate database, deploy updated MCP server, publish workflow to n8n, run smoke tests, and communicate change to operators.

## Sequencing & Dependencies
- Schema/tool uplift (Phase 1) blocks everything else; landing migrations early unlocks persona/project configuration and workflow refactors.
- Workflow refactor (Phase 3) depends on project/persona data being accurate and `trace_prep` returning final prompts.
- Testing/extensions (Phase 5) should start once happy-path flow works end-to-end to prevent regressions during rollout.
- Documentation (Phase 6) can iterate in parallel once architecture stabilizes, but final publication must trail successful integration tests.

## Known Risks & Mitigations
- **Data migration risk:** simultaneous removal of legacy tables could break existing tooling—stage migrations with feature flags and provide data backfill scripts.
- **Workflow downtime:** deploying a new universal workflow may interrupt active traces—plan a cut-over window and add backward-compatible webhook handling.
- **External API variance:** Veo’s integration depends on Shotstack/OpenAI APIs; mock them in tests and provide retry/backoff strategies.
- **TraceId format ambiguity:** Aligning on UUID vs. human-readable IDs impacts database schema and n8n payloads; resolve before Phase 1 migration.

## Decisions (from user feedback)
- Use `trace_prepare` as the unified preprocessing endpoint.
- Retain UUID-based `traceId` storage; introduce presentation helpers only if needed.
- Model each project with a single `workflow` pipeline (array of personas) plus `optional_steps`, `specs`, and `hitlPoints` metadata.
- Remove Casey’s blocking wait loop; the final persona in the workflow communicates completion to the user.
- Proceed with decommissioning legacy orchestrator tables—no live systems depend on them.


