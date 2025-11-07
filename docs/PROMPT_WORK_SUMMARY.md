# Prompt Alignment Work Summary

**Date:** November 7, 2025  
**Status:** ✅ Phase 1 Complete - Foundation Established  
**Next:** Phase 2 - Create Missing Personas

---

## What Was Accomplished

### 1. Comprehensive Planning Documents Created

#### A. **PROMPT_ALIGNMENT_PLAN.md** (Main Planning Document)
- **Location:** `docs/PROMPT_ALIGNMENT_PLAN.md`
- **Size:** 1,268 lines
- **Contents:**
  - Executive summary with gaps and blockers
  - Current state analysis (existing personas, projects)
  - Gap analysis (critical missing pieces)
  - Prompt architecture vision (5-layer structure)
  - 6-phase implementation plan with 20+ tasks
  - Success criteria and risk mitigation
  - Tool catalog reference

**Key Sections:**
```
- Current State: 35% system complete
- Critical Gaps: Missing Veo, Alex, Quinn personas
- Architecture: Global contract + persona identity + tools + workflow + validation
- Phases: Foundation → Missing Personas → Update Existing → Projects → Testing → Docs
- Timeline: 7 days estimated
```

#### B. **PROMPT_STATUS_SUMMARY.md** (Quick Reference Dashboard)
- **Location:** `docs/PROMPT_STATUS_SUMMARY.md`
- **Size:** 395 lines
- **Contents:**
  - Visual progress bars for each persona
  - Critical gaps blocking production
  - North Star alignment scorecard
  - Implementation priority phases
  - Key architecture decision questions

**Quick Stats:**
```
Casey:  60% ████████████░░░░░░░░
Iggy:   65% █████████████░░░░░░░
Riley:  65% █████████████░░░░░░░
Veo:     0% ░░░░░░░░░░░░░░░░░░░░ ← CRITICAL
Alex:    0% ░░░░░░░░░░░░░░░░░░░░ ← CRITICAL
Quinn:   0% ░░░░░░░░░░░░░░░░░░░░ ← CRITICAL

Overall: 35% ███████░░░░░░░░░░░░░
```

---

### 2. Foundation Files Created (Phase 1)

#### A. **Global Trace Coordination Contract**
- **Location:** `data/prompts/global-trace-contract.json`
- **Size:** 418 lines
- **Purpose:** Universal rules inherited by all personas

**What It Contains:**
```json
{
  "trace_discipline": {
    "Never invent IDs": "Always use provided {traceId, projectId, sessionId}",
    "Always tag memories": "Include metadata.traceId in every memory_store",
    "Copy-paste traceId": "Don't retype or modify it"
  },
  "tool_call_sequence": {
    "Step 1": "memory_search (load context)",
    "Step 2": "Execute work",
    "Step 3": "memory_store (save outputs)",
    "Step 4": "handoff_to_agent (brief next agent)"
  },
  "memory_tagging_requirements": {
    "Required fields": ["content", "memoryType", "persona", "project", "metadata.traceId"],
    "Content format": "Single line, no newlines, max 500 chars",
    "Examples": "Provided for each persona"
  },
  "handoff_discipline": {
    "Critical": "Call handoff_to_agent tool, not memory_store",
    "Instructions": "Natural language, 2-4 sentences",
    "Must include": ["what to do", "for what project", "where to find work", "what after"]
  },
  "special_handoffs": {
    "complete": "Quinn signals workflow done",
    "error": "Any agent signals blocking error"
  }
}
```

**Key Features:**
- ✅ Clear "never invent IDs" guardrail
- ✅ 4-step tool sequence standardized
- ✅ Memory tagging requirements explicit
- ✅ Handoff vs memory distinction clarified
- ✅ Good/bad examples for every rule
- ✅ Common mistakes documented with fixes
- ✅ Confidence-building principles

---

#### B. **MCP Tools Catalog**
- **Location:** `data/prompts/mcp-tools-catalog.json`
- **Size:** 686 lines  
- **Purpose:** Complete reference for all MCP tools

**Tools Documented (10 total):**
1. **memory_search** - Find memories (all personas)
2. **memory_store** - Save outputs (all personas)
3. **handoff_to_agent** - Transfer ownership (all personas)
4. **trace_create** - Create production run (Casey only)
5. **trace_update** - Update trace metadata (Casey only)
6. **context_get_project** - Load project specs (Casey only)
7. **context_get_persona** - Load persona capabilities (Casey only)
8. **job_upsert** - Track async jobs (Veo/Alex only)
9. **jobs_summary** - Check job completion (Veo/Alex only)
10. **workflow_complete** - Deprecated, use handoff (Quinn)

**For Each Tool:**
```
- Purpose (one sentence)
- When to use (3-5 bullet points)
- Parameters:
  - Required (with descriptions and examples)
  - Recommended (with why and examples)
  - Optional (with guidelines and ranges)
- Returns (schema and description)
- Examples (3-5 real-world use cases)
- Common errors (cause + fix)
```

**Example Entry Structure:**
```json
{
  "memory_search": {
    "purpose": "Find relevant memories by semantic similarity, keywords, or filters",
    "when_to_use": [
      "At workflow start: Load upstream work from prior agents",
      "During work: Check for duplicates or prior attempts",
      "For context: Find project specs or guidelines"
    ],
    "parameters": {
      "required": { "query": "..." },
      "recommended": { "traceId": "Filter to current production run", "project": "..." },
      "optional": { "memoryTypes": [...], "minSimilarity": 0.7, "expandGraph": true }
    },
    "examples": [
      { "use_case": "Load upstream work", "payload": {...} },
      { "use_case": "Check uniqueness", "payload": {...} }
    ],
    "common_errors": [
      { "error": "Returns memories from all traces", "fix": "Always include traceId filter" }
    ]
  }
}
```

---

### 3. Audit Results

#### Existing Persona Quality Scores

| Persona | Strengths | Weaknesses | Priority |
|---------|-----------|------------|----------|
| **Casey** (60%) | • Detailed context loading<br>• Good tool examples<br>• Clear handoff flow | • Not aligned to trace_prep<br>• Too verbose<br>• No global contract reference | Medium |
| **Iggy** (65%) | • Strong uniqueness validation<br>• Good memory discipline<br>• Clear workflow steps | • Overly complex graph traversal<br>• Not trace-centric<br>• Missing handoff standards | Medium |
| **Riley** (65%) | • Excellent spec compliance<br>• Good validation checklist<br>• Clear timing rules | • Spec loading too complex<br>• Missing trace context<br>• No handoff examples | Medium |
| **Veo** (0%) | N/A | **MISSING ENTIRELY** | **CRITICAL** |
| **Alex** (0%) | N/A | **MISSING ENTIRELY** | **CRITICAL** |
| **Quinn** (0%) | N/A | **MISSING ENTIRELY** | **CRITICAL** |

---

## North Star Alignment Analysis

### What's Working ✅

1. **Self-Discovery Pattern (100%)**
   - trace_prep loads persona dynamically
   - buildPersonaPrompt() assembles context at runtime
   - deriveAllowedTools() scopes tools per persona
   - Projects define workflow order

2. **Tool Infrastructure (100%)**
   - All 10 MCP tools implemented
   - Tool handlers follow consistent patterns
   - Returns are well-structured
   - Error handling exists

### What's Broken ❌

1. **Trace-Driven Discipline (20%)**
   - Prompts don't emphasize traceId
   - No "never invent IDs" guardrail
   - Tool sequences not standardized
   - Examples missing traceId

2. **Autonomous Handoffs (40%)**
   - Some prompts call memory_store instead of handoff_to_agent
   - Instructions vague ("do your job")
   - Next agent doesn't know where to find work
   - Special targets (complete, error) not documented

3. **Memory Discipline (30%)**
   - Single-line content not enforced
   - metadata.traceId not required in examples
   - Persona/project arrays sometimes scalar
   - Tags guidance weak

---

## Critical Gaps Identified

### 1. Missing Personas (Blocks Complete Testing)

**Veo (Production):**
```
Missing workflow:
1. Load Riley's screenplays (memory_search)
2. Call video generation APIs
3. Track jobs (job_upsert)
4. Validate completion (jobs_summary)
5. Store URLs (memory_store)
6. Handoff to Alex (handoff_to_agent)

Impact: Cannot test Riley → Veo → Alex chain
Timeline: Must create before Epic 2.3
```

**Alex (Editor):**
```
Missing workflow:
1. Load Veo's video URLs (memory_search)
2. Call editing API/toolWorkflow
3. Track edit job (job_upsert)
4. HITL approval (n8n Telegram node)
5. Store final edit (memory_store)
6. Handoff to Quinn (handoff_to_agent)

Impact: Cannot test Veo → Alex → Quinn chain
Timeline: Must create before Epic 2.3
```

**Quinn (Publisher):**
```
Missing workflow:
1. Load Alex's final edit (memory_search)
2. Publish to platforms (HTTP nodes)
3. Store publish URLs (memory_store)
4. Signal completion (handoff_to_agent toAgent: 'complete')
5. Notify user (Telegram message)

Impact: Cannot test complete workflow or completion signal
Timeline: Must create before Epic 2.3
```

---

### 2. Integration Points Not Defined

**trace-prep.ts needs updates:**
```typescript
// Current: Doesn't load global contract
function buildPersonaPrompt(params) {
  return params.personaPrompt + trace context + project + memories;
}

// Needed: Prepend global contract
function buildPersonaPrompt(params) {
  const globalContract = loadGlobalContract(); // NEW
  const toolCatalog = loadToolCatalog(params.personaName); // NEW
  return globalContract + toolCatalog + params.personaPrompt + ...;
}
```

**Questions to Answer:**
1. Should global contract be prepended in trace-prep.ts or stored as semantic memory?
   - **Recommendation:** Prepend in trace-prep.ts (guarantees delivery)

2. Should tool catalog be filtered per persona or full for everyone?
   - **Recommendation:** Filtered by allowedTools (reduces prompt size)

3. Should persona systemPrompt be short identity or full workflow?
   - **Recommendation:** Short identity (2-3 sentences) + workflow reference

---

## Recommended Next Steps

### Immediate (Today)

1. **Review these documents** with team/stakeholders
2. **Answer 3 architecture questions** (see PROMPT_STATUS_SUMMARY.md)
3. **Validate the approach** before proceeding to Phase 2

### Phase 2 (Tomorrow - Days 2-3)

**Create Missing Personas:**
1. **Veo (Production)** - Video generation coordinator
   - Load Riley's screenplays
   - Call video APIs
   - Track jobs
   - Store URLs
   - Handoff to Alex

2. **Alex (Editor)** - Compilation stitcher
   - Load Veo's videos
   - Call editing API
   - Handle HITL approval
   - Store final edit
   - Handoff to Quinn

3. **Quinn (Publisher)** - Platform publisher
   - Load Alex's final edit
   - Publish to platforms
   - Store publish URLs
   - Signal completion
   - Notify user

**Timeline:** 1 day  
**Blocker Status:** Phase 1 complete, can proceed  
**Priority:** CRITICAL - blocks complete handoff chain testing

---

### Phase 3 (Days 4-5)

**Update Existing Personas:**
1. Casey - Align with trace_prep, add global contract reference
2. Iggy - Simplify, add trace context, standardize handoffs
3. Riley - Add trace context, simplify spec loading

**Timeline:** 2 days  
**Blocker Status:** Can start after Phase 2  
**Priority:** HIGH - needed for production readiness

---

### Phase 4 (Days 5-6)

**Enhance Projects:**
1. AISMR - Add agent expectations, detailed guardrails
2. GenReact - Add detailed specs, quality criteria

**Timeline:** 1 day  
**Blocker Status:** Can start after Phase 3  
**Priority:** MEDIUM - improves quality

---

### Phase 5 (Day 6)

**Integration & Testing:**
1. Update trace-prep.ts to load global contract
2. Test prompt delivery end-to-end
3. Validate Casey → Iggy → Riley chain

---

### Phase 6 (Day 7)

**Documentation & Rollout:**
1. Update MCP_PROMPT_NOTES.md
2. Update AGENTS.md
3. Create migration guide

---

## Files Created

```
docs/
├── PROMPT_ALIGNMENT_PLAN.md          ← Main planning document (1,268 lines)
├── PROMPT_STATUS_SUMMARY.md          ← Quick reference dashboard (395 lines)
└── PROMPT_WORK_SUMMARY.md            ← This file (summary of work done)

data/prompts/
├── global-trace-contract.json        ← Universal rules for all personas (418 lines)
└── mcp-tools-catalog.json            ← Complete tool reference (686 lines)
```

**Total Lines Written:** 2,767 lines of structured planning, contracts, and catalogs

---

## Key Decisions Made

### 1. Prompt Architecture
**Decision:** 5-layer structure (contract → identity → tools → workflow → validation)  
**Why:** Ensures consistency, reduces duplication, enables confidence

### 2. Global Contract Delivery
**Decision:** Prepend in trace-prep.ts (not database memory)  
**Why:** Guarantees every agent sees it, no dependency on memory system

### 3. Tool Catalog Structure
**Decision:** Shared catalog, filtered per persona by allowedTools  
**Why:** Single source of truth, no duplication, easy to update

### 4. systemPrompt Field Usage
**Decision:** Short identity (2-3 sentences) + workflow reference  
**Why:** Keeps field clean, allows trace_prep to inject context properly

### 5. Handoff Standardization
**Decision:** Always include 4 things (what, project, where, after)  
**Why:** Next agent has complete context, no guessing

---

## Success Metrics

### Coverage Targets
- Persona prompt completion: 35% → 100% (6/6 personas)
- Project prompt completion: 60% → 100% (full specs + workflows)
- North Star alignment: 20% → 100% (all principles followed)

### Quality Targets
- Every persona: systemPrompt + semantic workflow + tool catalog + validation checklist
- Every project: workflow array + guardrails + agent expectations + examples
- Every tool: purpose + when/how/why + examples + common errors

### Confidence Targets
- Agent can follow workflow without getting stuck: 100%
- Agent knows which tools to call: 100%
- Agent understands handoff requirements: 100%

---

## What This Enables

### Immediate Benefits
1. **Clear Standards** - Everyone knows what good prompts look like
2. **Comprehensive Planning** - 7-day roadmap with clear milestones
3. **Foundation Built** - Global contract and tool catalog ready to use

### Short-Term (After Phase 2)
1. **Complete Pipeline** - All 6 personas have prompts
2. **End-to-End Testing** - Can test Casey → Iggy → Riley → Veo → Alex → Quinn
3. **Trace Discipline** - All agents follow trace coordination contract

### Long-Term (After Phase 6)
1. **Production Ready** - Prompts aligned to North Star, confident execution
2. **Easy Maintenance** - Single source of truth, DRY principles
3. **Scalable** - Easy to add new personas/projects with templates

---

## Questions for Review

### Architecture
1. ✅ **Approved?** 5-layer prompt architecture (contract → identity → tools → workflow → validation)
2. ✅ **Approved?** Global contract prepended in trace-prep.ts
3. ✅ **Approved?** Tool catalog filtered by allowedTools

### Implementation
1. **Should we proceed** with Phase 2 (create missing personas)?
2. **Any changes needed** to global contract or tool catalog?
3. **Any concerns** about the 7-day timeline?

### Testing
1. **When should we test** prompt delivery (after each phase or at end)?
2. **What level of testing** (unit, integration, e2e)?
3. **Who validates** prompt quality and North Star alignment?

---

## Next Session Actions

1. **If approved:** Mark Phase 2 todos as in-progress, start creating Veo persona
2. **If changes needed:** Update global contract or tool catalog based on feedback
3. **If questions:** Discuss architecture decisions before proceeding

---

**Status:** ✅ Phase 1 Complete - Ready for Phase 2  
**Blockers:** None - awaiting approval to proceed  
**Confidence:** High - foundation is solid, plan is comprehensive  
**Timeline:** On track for 7-day completion (Nov 14, 2025)

