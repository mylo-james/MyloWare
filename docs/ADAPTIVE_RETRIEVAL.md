# Adaptive Retrieval Architecture

**Last updated:** October 31, 2025  
**Owner:** MCP Prompts Team  

---

## 1. Objectives

- Let agents decide _when_ to retrieve context instead of always pulling memory.
- Provide explicit, inspectable reasoning for each retrieval action.
- Balance latency against answer quality with bounded iteration loops.
- Ensure every retrieval call carries provenance metadata (why, which strategy, confidence).

---

## 2. System Overview

```
┌───────────────────┐
│  Agent Input      │  query, partial context, task metadata
└────────┬──────────┘
         │
         ▼
┌───────────────────┐   assess need, choose strategy
│ Decision Module   │───────────────────────────────────────┐
└────────┬──────────┘                                       │
         │ yes?                                             │ no?
         ▼                                                  │
┌───────────────────┐                                       │
│ Query Formulator  │  build retrieval brief                │
└────────┬──────────┘                                       │
         │                                                  │
         ▼                                                  │
┌───────────────────┐   vector, keyword, hybrid, routed     │
│ Retrieval Engine  │<──────────────────────────────────────┘
└────────┬──────────┘
         │ results + telemetry
         ▼
┌───────────────────┐
│ Utility Scorer    │  evaluate quality + decide follow-up
└────────┬──────────┘
         │ iterate (max N) / stop
         ▼
┌───────────────────┐
│ Aggregator        │  merge iterations + annotate provenance
└───────────────────┘
```

---

## 3. Decision Workflow

1. **Signal Collection**
   - Inputs: user query, recent conversation summary, agent state, prior retrieval metadata.
   - Derived features: intent classification, memory routing hints, query embeddings, entropy of existing context.

2. **Need Assessment (`shouldRetrieve`)**
   - Prompt template uses structured reasoning: _knowledge sufficiency_, _ambiguity_, _risk of outdated data_.
   - Output: `{ decision: yes|no|maybe, rationale, confidence (0-1), urgency }`.
   - Thresholds:
     - `confidence ≥ 0.65` and `decision = yes` → fetch.
     - `confidence ≤ 0.35` or `decision = no` → skip.
     - Otherwise run lightweight heuristic (e.g., query length > 8 words, contains “update/summary/latest”).

3. **Strategy Selection**
   - Map intent + urgency to retrieval strategy (see §5).
   - Example: `workflow_step` intent + high urgency → Procedural memory first, fallback to semantic.

4. **Query Formulation**
   - Compose retrieval brief with:
     - Target memories (`memoryTypes`, `searchMode`).
     - Enriched query text (summaries, key nouns, extracted slots).
     - Constraints (temporal boost, result limit, dedupe keys).
   - Cache key = SHA256(query ∥ strategy ∥ sessionId) for short-term reuse.

5. **Execution & Utility Scoring**
   - Run retrieval, gather telemetry `({similarity}, latency, source)`.
   - Utility score `U = w_sim * avg(similarity) + w_cov * coverage + w_conf * decision.confidence`.
   - Default weights: `w_sim=0.5`, `w_cov=0.3`, `w_conf=0.2`.
   - Coverage metric = `min(1, uniqueTopics / neededTopics)` where topics come from classifier tags.

6. **Iteration & Termination**
   - Stop if `U ≥ 0.75` or result count ≥ requested limit.
   - Otherwise iterate (refine query / switch strategy).
   - Hard caps:
     - **Max iterations:** 3.
     - **Max wall-clock:** 1800 ms (configurable per environment).
   - On termination produce `IterationLog[]` with rationale, adjustments, and utility deltas.

7. **Aggregation & Handoff**
   - Deduplicate by `chunkId`, prefer higher similarity.
   - Track provenance: `strategy`, `iteration`, `memoryComponents`, `query`.
   - Expose final utility + reasons for the agent to cite in the final answer.

---

## 4. Confidence & Risk Scoring

| Dimension         | Inputs                                             | Output Scale | Notes                                                         |
| ----------------- | -------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| Knowledge Sufficiency | LLM judgment, context length, unresolved TODOs     | 0–1          | Higher implies existing context adequate.                     |
| Freshness Risk    | Query keywords (“latest”, “today”), resource age   | 0–1          | Drives temporal boost + iterative fallback scheduling.        |
| Ambiguity         | Entity extraction entropy, unanswered questions    | 0–1          | High ambiguity triggers hypothesis-driven search.             |
| Safety Criticality| Intent tags (legal, medical), user profile flags   | boolean      | Forces retrieval even if sufficiency high; adds audit trail.  |

**Composite Confidence** = `0.5 * (1 - ambiguity)` + `0.3 * knowledgeSufficiency` + `0.2 * (1 - freshnessRisk)`.  
Override rules:
- If safety critical → decision forced to `yes` with `confidence = max(confidence, 0.8)`.
- If knowledge sufficiency > 0.85 and ambiguity < 0.2 → auto `no`.

---

## 5. Retrieval Strategy Taxonomy

| Strategy           | Description                                                      | Primary Use Cases                         | Memory Targets                | Fallback Path                                 |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------- | ----------------------------- | --------------------------------------------- |
| **Single-shot**    | One execution with auto-selected mode & filters                  | Simple lookups, narrow persona/project    | Memory router default         | Return results; no iteration                  |
| **Iterative**      | Loop refine / expand queries up to N iterations                  | Broad research, open-ended questions      | Semantic + project + persona  | Switch to hypothesis-driven if low coverage   |
| **Hypothesis-driven** | Generate assumptions, test via targeted queries                  | Ambiguous intents, conflicting signals    | Semantic + graph expansion    | Promote best hypothesis or fallback to iterative |
| **Multi-hop**      | Use graph traversal across memory links                          | Relationship mapping, playbooks           | Semantic + procedural + graph | Convert to iterative if latency budget exceeded |
| **Fallback**       | Try alternative search modes (keyword-only, episodic) when primary fails | Search errors, low similarity returns        | Keyword, episodic, external APIs | Escalate alert if all fail                    |
| **Temporal-first** | Boost recency aggressively, bias towards latest updates          | “What changed”, status checks             | Semantic (recent), episodic   | Switch to Single-shot with standard decay     |
| **Compliance**     | Mandatory retrieval irrespective of decision confidence          | Regulated content, user policy requests   | Procedural + logs archive     | Escalate to human if insufficient             |

Each strategy defines:
- Default `searchMode`, `memoryTypes`, `temporalBoost`.
- Iteration policy (max loops, refinement heuristics).
- Telemetry tags for analytics dashboards.

---

## 6. Iteration Management

- **Iteration Blueprint**
  1. Evaluate utility.
  2. If below threshold, select refinement heuristic:
     - Tighten: add extracted keywords or entity filters.
     - Broaden: remove filters, include related intents.
     - Switch mode: vector ↔ keyword ↔ hybrid.
  3. Log rationale (structured string) for observability.
  4. Re-run retrieval respecting latency budget.

- **Timeout Handling**
  - Abort if cumulative latency > `RETRIEVAL_TIMEOUT_MS`.
  - Partial results returned with `status = degraded`.
  - Telemetry event `adaptive-retrieval-timeout` for monitoring.

---

## 7. Telemetry & Observability

- **Structured Log Fields**
  - `decision`: yes/no/maybe.
  - `strategy`: taxonomy label.
  - `confidence`: composite score.
  - `iterations`: count + per-iteration utility.
  - `latency_ms`: total + breakdown.
  - `result_count`, `coverage`, `similarity_stats`.

- **Metrics to Emit**
  - `adaptive_retrieval_decisions_total{strategy, outcome}`
  - `adaptive_retrieval_latency_ms_bucket`
  - `adaptive_retrieval_utility_score{strategy}`
  - `adaptive_retrieval_timeout_total`

- **Dashboards**
  - Decision heatmap (confidence vs. strategy usage).
  - Utility distribution by intent.
  - Latency vs. iteration count.

---

## 8. Configuration Surface

| Variable                            | Default | Description                                      |
| ----------------------------------- | ------- | ------------------------------------------------ |
| `ADAPTIVE_ENABLED`                  | `false` | Global feature flag for adaptive retrieval       |
| `RETRIEVAL_MAX_ITERATIONS`          | `3`     | Hard cap on iteration loop                       |
| `RETRIEVAL_UTILITY_THRESHOLD`       | `0.75`  | Stop condition for acceptable result             |
| `RETRIEVAL_TIMEOUT_MS`              | `1800`  | Total latency budget per adaptive call           |
| `RETRIEVAL_CACHE_TTL_MS`            | `60000` | Reuse identical retrieval briefs briefly         |
| `RETRIEVAL_SAFETY_OVERRIDE_INTENTS` | List    | Intents that automatically force retrieval       |

All configuration values belong in `src/config/index.ts` with environment overrides.

---

## 9. Integration Checklist

- [ ] Implement `retrievalDecisionAgent` using this workflow.
- [ ] Build orchestrator with iteration + strategy switching.
- [ ] Add MCP tool `prompts_search_adaptive` exposing telemetry.
- [ ] Update agent prompts to summarize decision rationale in responses.
- [ ] Create runbooks for debugging low-utility or high-latency cases.

---

## 10. Open Questions

1. Should iterative retrieval reuse embeddings or re-embed refinements each time?
2. Do we require cross-session caching for popular queries (e.g., product statuses)?
3. How do we expose adaptive retrieval telemetry to downstream analytics (Amplitude/Grafana)?
4. What safe-guards are needed before enabling in production (A/B gating, manual review)?
5. Should we integrate external web search as a late-stage fallback when internal memories suffices?

Contributions welcome—open a PR and update the checklist above.

