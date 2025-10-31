# Adaptive Memory Architecture Design

**Date:** October 30, 2025  
**Author:** MCP Prompts Team  
**Status:** Draft – aligns with Phase 2, Step 2.1.1 of the modernization plan

---

## Objectives

- Establish a clear taxonomy for long-term memory components that aligns with current prompt metadata and roadmap goals.
- Define routing heuristics the agent can use to select the appropriate memory component(s) for a query.
- Evaluate database layout options and record the default choice ahead of implementation work in Step 2.1.2.
- Outline a zero-downtime migration approach for evolving the existing `prompt_embeddings` table.

---

## Memory Taxonomy

| Memory Type           | Purpose                                                                              | Typical Content                                                        | Retention Strategy                                             |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Persona Memory**    | Capture durable information about defined personas (tone, capabilities, guardrails). | Persona bios, do/don’t lists, response patterns, escalation policies.  | Versioned manually; change rarely.                             |
| **Project Memory**    | Preserve project-specific prompts and SOPs.                                          | Project briefs, workflows, deliverable templates, status docs.         | Update per project cadence; retire when project archived.      |
| **Semantic Memory**   | House general-purpose knowledge that should be reusable across personas/projects.    | Technical best practices, tooling guidance, integration notes.         | Continuous ingestion; prune via relevance + temporal decay.    |
| **Episodic Memory**   | Store conversation history and ephemeral context to support continuity.              | Turn-level transcripts, condensed summaries, follow-up tasks.          | Retain 90 days raw, summarize beyond, hard-delete at 180 days. |
| **Procedural Memory** | Describe executable workflows, automations, and playbooks.                           | Step-by-step task flows, CLI automation sequences, MCP action recipes. | Versioned with execution metrics; sunset when superseded.      |

### Cross-Component Relationships

- Personas and projects may reference semantic or procedural documents via `related_chunk_ids`.
- Episodic entries can link back to persona/project identifiers to accelerate routing.
- Procedural memory can embed references to semantic prerequisites and expected persona roles.

---

## Query Routing Guidelines

| Signal                                                                                   | Routing Action                                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Persona name mentioned or classifier intent `persona_lookup`.                            | Prioritise Persona Memory; fallback to Semantic if no match.                    |
| Project slug / codename mentioned or classifier intent `project_lookup`.                 | Project Memory first; broaden to Semantic for supporting docs.                  |
| Workflow verbs (“step-by-step”, “how to execute…”) or classifier intent `workflow_step`. | Procedural Memory primary, then Semantic for explanations.                      |
| Conversational continuity markers (“as we discussed”, session id present).               | Episodic Memory scoped to session, optionally fuse with Semantic.               |
| Pure knowledge request lacking persona/project cues.                                     | Semantic Memory baseline; incorporate Persona/Project if auto-filters trigger.  |
| Ambiguous or multi-intent queries.                                                       | Execute hybrid routing: sample top-k from relevant components and fuse via RRF. |

Routing implementation considerations:

- Maintain lightweight heuristics for initial rollout, backed by the existing intent classifier and metadata filters.
- Log routing decisions and component scores to support later learning-based routing improvements.
- Provide override switches (feature flags + request parameters) to force single-component execution for debugging.

---

## Storage Design Options

### Option A — Separate Tables per Memory Type

- **Pros:** Clear physical separation, easier per-type retention policies.
- **Cons:** Migration complexity; duplicative schema definitions; higher maintenance overhead for cross-memory queries.

### Option B — Single Table with `memory_type` Column (Recommended)

- **Pros:** Minimal migration delta; leverages existing `prompt_embeddings` infrastructure; easier hybrid searches across types.
- **Cons:** Requires thoughtful composite indices; retention logic must filter by `memory_type`.
- **Decision:** Adopt Option B. Add an enum column `memory_type` with values `persona | project | semantic | episodic | procedural`. Augment with targeted partial indices and filtered materialized views where necessary.

### Option C — Separate Databases

- **Pros:** Maximum isolation and scaling flexibility.
- **Cons:** Overkill for current scale; complicates migrations, backups, and cross-memory fusion. Not recommended.

---

## Migration Strategy (Step 2.1.2 Preview)

1. **Schema Migration**
   - Add `memory_type` enum + column to `prompt_embeddings` with default `'semantic'`.
   - Create partial indices keyed by `(memory_type, updated_at)` plus a JSONB GIN index for metadata per type.
   - Ensure triggers continue to populate `textsearch` and updated timestamps.

2. **Backfill Script**
   - Determine memory type from `metadata.type` when available.
   - Fallback heuristics:
     - Persona slug in `metadata.persona` → `persona`.
     - Project slug in `metadata.project` → `project`.
     - Files under `episodic/` (future ingestion) → `episodic`.
     - Workflow labels (`metadata.tags` includes `workflow`) → `procedural`.
   - Run inside a transaction with batched updates to avoid long locks.

3. **Zero-Downtime Considerations**
   - Deploy migration with column default + null-safe reads before backfill.
   - Update application code to write `memory_type` once column is live, still compatible with null/legacy rows.
   - Backfill in chunks using `UPDATE … WHERE memory_type IS NULL LIMIT n`.
   - After verification, enforce `NOT NULL` and drop transitional defaults.

4. **Verification**
   - Add sanity checks (count per memory type, orphaned rows).
   - Run targeted search queries ensuring routing logic respects the new column.

---

## Next Steps

1. Implement schema changes described above (`0003_add_memory_components.sql`).
2. Update repository and ingestion pipelines to read/write `memory_type`.
3. Extend routing logic (Step 2.1.3) to consume the taxonomy and heuristics documented here.
4. Instrument monitoring dashboards to track query routing distributions by memory type.
