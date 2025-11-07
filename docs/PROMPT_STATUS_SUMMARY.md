# Prompt Status Summary

**Last Updated:** November 7, 2025  
**See Full Plan:** [PROMPT_ALIGNMENT_PLAN.md](./PROMPT_ALIGNMENT_PLAN.md)

---

## Quick Status Dashboard

### Persona Prompt Completion

```
Casey (Showrunner)     [████████████░░░░░░░░] 60% - Needs trace_prep alignment
Iggy (Creative Dir)    [█████████████░░░░░░░] 65% - Needs North Star workflow
Riley (Head Writer)    [█████████████░░░░░░░] 65% - Needs trace context
Veo (Production)       [░░░░░░░░░░░░░░░░░░░░]  0% - Missing completely
Alex (Editor)          [░░░░░░░░░░░░░░░░░░░░]  0% - Missing completely
Quinn (Publisher)      [░░░░░░░░░░░░░░░░░░░░]  0% - Missing completely

Overall System:        [███████░░░░░░░░░░░░░] 35%
```

### Project Prompt Completion

```
AISMR                  [██████████████░░░░░░] 70% - Good specs, needs workflow
GenReact               [████████████████░░░░] 80% - Has workflow, needs specs
General                [██████░░░░░░░░░░░░░░] 30% - Minimal, needs expansion

Overall Projects:      [████████████░░░░░░░░] 60%
```

---

## Critical Gaps (Blocking Production)

### 1. Missing Personas (Critical Priority)

```
❌ Veo (Production)
   - No guidance on video generation
   - No job tracking instructions
   - Blocks Veo → Alex handoff testing

❌ Alex (Editor)  
   - No editing workflow
   - No HITL approval handling
   - Blocks Alex → Quinn handoff testing

❌ Quinn (Publisher)
   - No publishing workflow
   - No completion signaling
   - Blocks end-to-end testing
```

**Impact:** Cannot test complete Casey → Iggy → Riley → Veo → Alex → Quinn chain

**Timeline:** Must be created before Epic 2.3 (Test Complete Handoff Chain)

---

### 2. Trace Workflow Not Clear (Critical Priority)

**Current Problem:**
```
❌ Prompts don't emphasize traceId as coordination fabric
❌ No "never invent IDs" guardrail
❌ Tool sequences not standardized
❌ Handoff discipline inconsistent
```

**Required Fix:**
```
✅ Global trace coordination contract (inherited by all)
✅ Clear tool call sequence: search → work → store → handoff
✅ traceId mentioned in every tool example
✅ Natural language handoff patterns standardized
```

---

### 3. Tool Catalog Missing (High Priority)

**Current State:**
- Tools mentioned by name only
- No when/how/why guidance
- No example JSON payloads
- No error handling

**Required:**
```
Tool Catalog for all 10+ MCP tools:
├── trace_create
├── trace_update
├── memory_search (with filters)
├── memory_store (with metadata)
├── handoff_to_agent (with instructions)
├── context_get_project
├── context_get_persona
├── job_upsert
├── jobs_summary
└── workflow_complete
```

Each tool needs:
- Purpose (1 sentence)
- When to use (3-5 bullet points)
- Required parameters
- Example JSON
- Common errors

---

## Prompt Quality Checklist

### ✅ What's Working

1. **Casey** - Detailed context loading workflow
2. **Iggy** - Strong uniqueness validation focus
3. **Riley** - Good spec compliance discipline
4. **AISMR Project** - Comprehensive specifications
5. **GenReact Project** - Has workflow array defined

### ⚠️ What Needs Improvement

1. **All Personas** - No global trace contract
2. **Casey, Iggy, Riley** - Not aligned to trace_prep pattern
3. **All Personas** - Tools listed but not explained
4. **All Personas** - Workflow not semantic/step-by-step
5. **Projects** - Missing agent expectations

### ❌ What's Missing

1. **Veo, Alex, Quinn** - Entire personas
2. **Global Contract** - Trace coordination rules
3. **Tool Catalog** - Comprehensive reference
4. **Validation Checklists** - Per-persona success criteria
5. **Integration Guide** - How prompts work together

---

## North Star Alignment Scorecard

### Trace-Driven Architecture

| Requirement | Status | Notes |
|-------------|--------|-------|
| Every persona uses traceId | 🟡 Partial | Not emphasized in prompts |
| Never invent IDs | ❌ Missing | No explicit guardrail |
| Memory tagged with traceId | 🟡 Partial | Examples don't show this |
| Handoff includes traceId | ❌ Missing | Not in handoff examples |
| Tools called in sequence | ❌ Missing | No standardized flow |

**Score:** 🔴 20% aligned

### Self-Discovery Pattern

| Requirement | Status | Notes |
|-------------|--------|-------|
| Agents discover role from trace | ✅ Working | trace_prep does this |
| Projects define workflow order | ✅ Working | GenReact has it |
| Personas loaded dynamically | ✅ Working | trace_prep handles |
| System prompt assembled runtime | ✅ Working | buildPersonaPrompt() |
| Tools scoped to persona | ✅ Working | deriveAllowedTools() |

**Score:** 🟢 100% aligned

### Autonomous Handoffs

| Requirement | Status | Notes |
|-------------|--------|-------|
| Agents call handoff_to_agent | 🟡 Partial | Some prompts unclear |
| Natural language instructions | 🟡 Partial | Not standardized |
| Next agent knows where to find work | ❌ Missing | Not in examples |
| Special targets (complete, error) | ❌ Missing | Not documented |
| Non-blocking async calls | ✅ Working | Tool handles |

**Score:** 🟡 40% aligned

### Memory Discipline

| Requirement | Status | Notes |
|-------------|--------|-------|
| Single-line content | 🟡 Partial | Not enforced in prompts |
| Persona array always included | 🟡 Partial | Examples missing |
| Project array always included | 🟡 Partial | Examples missing |
| Tags descriptive | 🟡 Partial | No guidance |
| metadata.traceId required | ❌ Missing | Not in examples |

**Score:** 🟡 30% aligned

---

## Implementation Priority

### Phase 1: Foundation (Must Do First)

```
1. Create global-trace-contract.json
2. Create mcp-tools-catalog.json
3. Update trace-prep.ts to load global contract
```

**Timeline:** 2 days  
**Blocks:** All other work

---

### Phase 2: Create Missing Personas (Next)

```
1. Create veo.json (Production agent)
2. Create alex.json (Editor agent)
3. Create quinn.json (Publisher agent)
```

**Timeline:** 1 day  
**Blocks:** Complete handoff chain testing

---

### Phase 3: Update Existing Personas (Then)

```
1. Update casey.json with trace_prep alignment
2. Update ideagenerator.json (Iggy) with North Star workflow
3. Update screenwriter.json (Riley) with trace context
```

**Timeline:** 2 days  
**Blocks:** Production readiness

---

### Phase 4: Enhance Projects (Finally)

```
1. Enhance aismr.json with agent expectations
2. Enhance genreact.json with detailed specs
3. Update general.json
```

**Timeline:** 1 day  
**Blocks:** Quality assurance

---

## Key Questions to Answer

Before implementing, we need to decide:

### 1. systemPrompt Field Usage

**Question:** Should `persona.systemPrompt` be:
- A) Short identity statement (2-3 sentences) + workflow reference?
- B) Complete prompt with all guidance?
- C) Just persona identity, workflow in separate field?

**Recommendation:** Option A - short identity + reference to workflow structure in JSON

**Why:** Keeps systemPrompt field clean, allows trace_prep to inject context properly

---

### 2. Global Contract Delivery

**Question:** How should global contract reach agents?
- A) Prepended to every systemPrompt in trace-prep.ts?
- B) Stored in database as semantic memory, loaded via memory_search?
- C) Hard-coded in buildPersonaPrompt() function?

**Recommendation:** Option A - prepended in trace-prep.ts

**Why:** Guarantees every agent sees it, no dependency on memory system

---

### 3. Tool Catalog Location

**Question:** Where should tool catalog live?
- A) In each persona JSON (duplicated)?
- B) In shared global JSON, loaded by trace-prep?
- C) In separate file per persona (tool-catalog-casey.json)?

**Recommendation:** Option B - shared catalog, filtered per persona

**Why:** Single source of truth, no duplication, easy to update

---

## Next Actions

1. **Review this plan** with team/stakeholders
2. **Validate architecture decisions** (3 questions above)
3. **Create Phase 1 files** (global contract + tool catalog)
4. **Test prompt delivery** with Casey → Iggy handoff
5. **Iterate based on feedback**

---

## Resources

- **Full Plan:** [PROMPT_ALIGNMENT_PLAN.md](./PROMPT_ALIGNMENT_PLAN.md)
- **North Star Vision:** [NORTH_STAR.md](./NORTH_STAR.md)
- **Implementation Plan:** [PLAN.md](./PLAN.md)
- **Current Prompt Notes:** [MCP_PROMPT_NOTES.md](./MCP_PROMPT_NOTES.md)

---

**Status:** 🚧 Planning Complete, Ready to Implement  
**Next Milestone:** Phase 1 Complete (Global Contract + Tool Catalog)  
**Target Date:** November 9, 2025

