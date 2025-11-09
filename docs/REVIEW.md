## AI Production Studio Review (PO Perspective)

**Date:** 2025-11-09   **Author:** GPT-5 Codex (acting PO for AI agents)

This review reframes the codebase through the lens of the **North Star mission**: deliver a memory-first, multi-agent production studio where Casey orchestrates handoffs across specialist agents using trace-aware context. The goal is to confirm that our implementation choices reinforce that mission, expose the gaps that jeopardize it, and translate findings into a product-ready backlog.

---

## Alignment Check: Code vs. North Star Vision

- **Trace-Centric Coordination** (`src/utils/trace-prep.ts`, `src/mcp/tools.ts`, `src/server.ts`)
  - ✅ `trace_prepare`, `trace_update`, and `handoff_to_agent` embody the universal workflow by enforcing trace IDs, optimistic locking, and structured handoffs.
  - ⚠️ Playbook data (`data/projects/<slug>/project.json`) is never surfaced because `loadProjectJson` looks for `data/projects/${projectName}.json`. Casey loses guardrails, making it harder to stay aligned with persona expectations.

- **Memory-First Fabric** (`src/tools/memory/*.ts`, `src/db/schema.ts`)
  - ✅ Strong vector+keyword retrieval, temporal decay, and retry queue keep procedural memories usable.
  - ⚠️ `MemoryRepository.vectorSearch/keywordSearch` still filter by `metadata ->> 'traceId'` instead of the indexed `memories.trace_id`, risking divergence and slowing large traces.

- **Persona + Workflow Contracts** (`data/personas/*`, `src/mcp/prompts.ts`)
  - ✅ Procedural memories and MCP prompt registration let personas run self-serve, with deterministic tool lists derived from persona names.
  - ⚠️ Without project playbooks, Casey lacks the dynamic guardrails outlined in the North Star, eroding multi-agent discipline.

- **Observability & Trustworthiness** (`src/utils/logger.ts`, `src/utils/metrics.ts`, `/metrics` endpoint)
  - ✅ Prometheus metrics, detailed logging, and retry counters support transparent operations.
  - ⚠️ Default security posture (CORS `['*']`, hard-coded host allowlist, verbose dev auth logs) undermines the trust pillar by widening the attack surface.

- **Human-in-the-Loop & Ethical Guardrails**
  - ✅ Telegram notifications on completion and rate-limiting show attention to human oversight.
  - ⚠️ Missing security hardening guide and production runbook prevent operators from confidently enforcing ethical guardrails in live runs.

---

## What's Working (Keep Investing)

- **North Star Translation:** MCP tool contracts, trace state machine, and retry queue directly reinforce Casey Specialist handoffs.
- **Memory Discipline:** Single-line enforcement, embeddings, and graph expansion ensure high recall and maintain episodic context.
- **Testing Culture:** Unit + integration + e2e coverage with deterministic OpenAI stubs supports rapid iteration without breaking the workflow.
- **Observability:** Histograms and counters across tools, workflows, DB queries, and retry queue give us actionable telemetry.

---

## Risks That Threaten the Vision

| # | Risk | Impact on North Star | Evidence |
|---|------|---------------------|----------|
| 1 | **Open CORS + hard-coded hosts** | Weakens trust & governance, exposing the studio to unauthorized actors. | `src/config/index.ts`, `src/server.ts` |
| 2 | **Project playbooks never load** | Casey loses scripted expectations, jeopardizing disciplined handoffs. | `src/utils/trace-prep.ts` (`loadProjectJson`) |
| 3 | **Trace filter via metadata JSON** | Potential drift between stored metadata and column; slows memory ops. | `src/db/repositories/memory-repository.ts` |
| 4 | **trace_update UUID vs. slug mismatch** | Agents risk failing updates, blocking project alignment. | `src/mcp/tools.ts` |
| 5 | **Verbose dev auth logs** | Leaks derived secrets in shared dev envs. | `src/server.ts` (`authenticateRequest`) |
| 6 | **ESLint ignores tests** | Lower signal on regression-prone code. | `eslint.config.mjs` |
| 7 | **Missing security hardening guide** | Human operators lack a runbook for safe deployments. | Docs gap |

---

## Product Backlog (Ordered for PO Execution)

### Now Stabilize the Production Studio
1. **Lock Down Entry Points**
   - Fail closed on CORS/allowed origins; externalize host allowlist. (Security + trust)
2. **Unblock Project Playbooks**
   - Fix `loadProjectJson` pathing (or reuse ingested metadata) so Casey's prompts surface guardrails and agent expectations.
3. **Resolve trace_update Contract**
   - Accept slugs and normalize to UUIDs *or* update docs + persona training to require UUIDs.
4. **Make Memory Filtering Deterministic**
   - Use `memories.traceId` column for search filters; keep metadata for redundancy only.
5. **Trim Dev Auth Logs**
   - Remove derived-key details unless a debug flag is set.

### Next Enable Confident Operations
1. **Security & Production Runbook**
   - Document required env vars, key rotation, rate-limits, and human-in-the-loop controls (aligns with ethical guardrails from PO best practices).
2. **Lint Tests with Guardrails**
   - Apply a relaxed ESLint config to `tests/**` to keep the written workflows healthy.
3. **Config-Driven Session Policies**
   - Expose TTL/max sessions via env so ops can tune scaling and compliance.

### Later Accelerate the Workflow Engine
1. **Memory Result Caching** for hot traces to reduce repeated embeddings.
2. **Advanced Retrieval Blending** to weight memory types per persona.
3. **Persona Playbook Surfacing** in MCP prompts (e.g., casey-specific checklists per trace).

---

## Strategic Recommendations (PO Readout)

- **Translate Strategy to Code:** Ensure every agent-facing prompt reflects the project playbooks; otherwise the universal workflow degenerates into improvisation.
- **Strengthen Human Oversight:** Provide ops runbooks, secure defaults, and clear fallback paths to maintain ethical guardrails and human-in-the-loop awareness.
- **Instrument for Trust:** Continue investing in metrics/logging but pair with security hygiene so telemetry doesn't come at the cost of exposure.
- **Close the Loop with Personas:** Once playbooks load correctly, revisit persona docs to confirm Casey, Iggy, and others receive the right tool lists and handoff instructions.

---

## Appendix: Key Artifacts Reviewed
- Runtime coordination: `src/server.ts`, `src/utils/trace-prep.ts`, `src/mcp/tools.ts`, `src/mcp/handlers.ts`
- Data & persistence: `src/db/schema.ts`, `src/db/repositories/*`, `drizzle/*.sql`
- Memory systems: `src/tools/memory/*`, `src/utils/*`
- Infrastructure & scripts: `package.json`, `start-dev.sh`, `scripts/n8n`, `docs/01-07`, `NORTH_STAR.md`
- Test coverage: `tests/unit`, `tests/integration`, `tests/e2e`

This rewrite centers the backlog around delivering the North Star experience: Casey orchestrates, specialists execute, memories persist while staying grounded in real code paths and product-owner best practices for leading AI agents.