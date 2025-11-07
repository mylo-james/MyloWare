# Prompt Alignment Plan: North Star & Plan.md Alignment

**Created:** November 7, 2025  
**Status:** 🚧 Planning Phase  
**Goal:** Align all persona, project, and system prompts with North Star V2 and ensure 100% agent confidence

---

## Executive Summary

Our prompts are the**critical interface** between our North Star vision (trace-driven, self-discovering agents) and actual execution. Currently:

- ✅ **Strengths:** Casey, Iggy (IdeaGenerator), and Riley (Screenwriter) have detailed prompts
- ⚠️ **Gaps:** Veo, Alex, and Quinn personas missing; existing prompts not aligned to trace_prep workflow
- ❌ **Blockers:** Prompts don't follow North Star semantic workflow; missing clear tool usage guidance; no confidence-building structure

This plan will transform our prompts into **step-by-step semantic workflows** that agents can follow with 100% confidence.

---

## Current State Analysis

### Existing Personas

| Persona | File | Status | Alignment Score | Notes |
|---------|------|--------|----------------|-------|
| Casey | `data/personas/casey.json` | ✅ Exists | 🟡 60% | Detailed but needs trace_prep alignment |
| Iggy | `data/personas/ideagenerator.json` | ✅ Exists | 🟡 65% | Good structure, needs North Star workflow |
| Riley | `data/personas/screenwriter.json` | ✅ Exists | 🟡 65% | Good validation focus, needs trace context |
| Veo | *Missing* | ❌ None | 0% | Production agent completely missing |
| Alex | *Missing* | ❌ None | 0% | Editor agent completely missing |
| Quinn | *Missing* | ❌ None | 0% | Publisher agent completely missing |

### Existing Projects

| Project | File | Status | Alignment Score | Notes |
|---------|------|--------|----------------|-------|
| AISMR | `data/projects/aismr.json` | ✅ Exists | 🟡 70% | Detailed specs, needs workflow definition |
| GenReact | `data/projects/genreact.json` | ✅ Exists | 🟢 80% | Has workflow array, needs specs |
| General | `data/projects/general.json` | ✅ Exists | 🔴 30% | Minimal, needs expansion |

### Prompt Delivery Mechanism

**Current Flow:**
```
1. n8n workflow receives trigger (Telegram/Chat/Webhook)
2. Edit Fields node normalizes inputs → {traceId?, sessionId, message, source}
3. trace_prep HTTP endpoint called → prepareTraceContext()
4. System prompt assembled:
   - If projectId === 'unknown': buildCaseyPrompt()
   - Else: buildPersonaPrompt(persona.systemPrompt + trace + project + memories)
5. AI Agent node receives: systemPrompt + instructions + allowedTools
6. Agent executes with MCP tools
```

**Key Issue:** The `persona.systemPrompt` field in persona JSONs is currently not being used effectively. The prompt builder concatenates it with trace context, but the persona prompts need to be **designed for this concatenation** to work well.

---

## Gap Analysis

### Critical Gaps

1. **Missing Personas (Veo, Alex, Quinn)**
   - No prompt guidance for production, editing, or publishing
   - Blocks complete workflow testing
   - Priority: **CRITICAL**

2. **Trace-Centric Workflow Not Clear**
   - Existing prompts don't emphasize traceId as coordination fabric
   - No clear "always use the provided traceId" instructions
   - Tools not presented in required sequence
   - Priority: **CRITICAL**

3. **Tool Usage Guidance Insufficient**
   - Tools listed but not explained
   - No clear when/how/why for each tool
   - Missing failure handling guidance
   - Priority: **HIGH**

4. **No Global System Introduction**
   - Each persona is isolated
   - No shared trace coordination contract
   - No common anti-patterns or guardrails
   - Priority: **HIGH**

5. **Confidence-Building Structure Missing**
   - Prompts are informational, not procedural
   - No step-by-step semantic workflows
   - No validation checklists
   - Priority: **HIGH**

6. **Handoff Instructions Not Standardized**
   - Each persona has different handoff patterns
   - Not aligned with North Star expectations
   - Missing next-agent context requirements
   - Priority: **MEDIUM**

---

## Prompt Architecture Vision

### Global Structure

Every persona prompt will follow this architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  GLOBAL TRACE COORDINATION CONTRACT (inherited by all)      │
│  - Trace discipline                                         │
│  - Never invent IDs                                         │
│  - Memory tagging requirements                              │
│  - Tool call sequence                                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PERSONA IDENTITY & ROLE                                    │
│  - Who you are                                              │
│  - Your expertise                                           │
│  - Your place in the pipeline                               │
│  - Your success criteria                                    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  TOOL CATALOG (specific to persona)                         │
│  - memory_search: when/how/why                              │
│  - memory_store: when/how/why                               │
│  - handoff_to_agent: when/how/why                           │
│  - [persona-specific tools]                                 │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  SEMANTIC WORKFLOW (step-by-step)                           │
│  Step 1: Load context (memory_search with traceId)          │
│  Step 2: Execute work (use project specs)                   │
│  Step 3: Store outputs (memory_store with traceId)          │
│  Step 4: Handoff to next (handoff_to_agent with traceId)    │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  VALIDATION & QUALITY                                       │
│  - Checklist: what must be true before handoff              │
│  - Common errors: what to avoid                             │
│  - Guardrails: project-specific rules                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  CONTEXT INJECTION (added by trace_prep at runtime)         │
│  - TRACE ID: {traceId}                                      │
│  - PROJECT: {project name, description, guardrails}         │
│  - INSTRUCTIONS: {from handoff_to_agent}                    │
│  - UPSTREAM WORK: {memory lines from trace}                 │
└─────────────────────────────────────────────────────────────┘
```

### Prompt Components Breakdown

#### 1. Global Trace Coordination Contract

```markdown
You are part of a trace-driven AI production pipeline. Follow this contract:

1. **Never Invent IDs** - Only use the provided {traceId, projectId, sessionId}
2. **Tool Call Sequence** - Always call tools in this order:
   a. memory_search (with traceId filter) to load context
   b. [do your work]
   c. memory_store (single line, include traceId in metadata)
   d. handoff_to_agent (clear natural language instructions)
3. **Memory Tagging** - Every memory MUST include:
   - metadata.traceId: the trace you're working on
   - persona: your persona name in array format
   - project: the project name in array format
4. **Handoff Discipline** - When handing off:
   - Use handoff_to_agent tool (don't just store a memory)
   - Include clear instructions for next agent
   - Tell them where to find your work (memory search by traceId)
5. **Error Handling** - If you encounter a blocking error:
   - Call handoff_to_agent with toAgent="error"
   - Include error details in instructions
```

#### 2. Persona-Specific systemPrompt Template

For Casey:
```markdown
# CASEY - THE SHOWRUNNER

## Role
You are Casey, the Showrunner. You START production runs and FINISH them (after Quinn signals completion). The middle belongs to your autonomous team.

## Your Expertise
- Project identification from user messages
- Context gathering (project specs, persona capabilities)
- Clear, empowering handoff instructions
- Completion notifications

## Your Place in Pipeline
Position 0 of 6: Casey → Iggy → Riley → Veo → Alex → Quinn
You hand off to: Iggy (Creative Director)

## Success Criteria
✅ Project identified correctly (aismr, genreact, etc.)
✅ Trace created with traceId captured
✅ Context loaded (project specs + Iggy persona)
✅ Clear instructions written for Iggy
✅ Handoff executed (tool called, not just logged)
✅ Trust established - no micro-management

[Rest of Casey-specific prompt...]
```

#### 3. Tool Catalog Structure

```markdown
## TOOL: memory_search

**Purpose:** Find relevant memories by semantic similarity or keywords

**When to Use:**
- At workflow start: Load upstream work from prior agents
- During work: Check for duplicates or prior attempts
- For context: Find project specs or persona expectations

**Key Parameters:**
- query (required): What you're searching for
- traceId (recommended): Filter to current production run only
- project (recommended): Filter to current project
- memoryTypes: ['episodic'] for session history, ['semantic', 'procedural'] for specs
- limit: How many results (default 12)
- minSimilarity: 0-1 threshold (0.7 for archive check, 0.85 for blocking)

**Example:**
```json
{
  "query": "Iggy's modifier list for trace-aismr-001",
  "traceId": "trace-aismr-001",
  "project": "aismr",
  "memoryTypes": ["episodic"],
  "limit": 12
}
```

**Returns:** Array of memories with content, persona, tags, metadata

**Common Errors:**
- Forgetting traceId filter → pulls memories from all traces
- Using wrong memoryTypes → misses relevant context
- Limit too low → incomplete context
```

---

## Implementation Plan

### Phase 1: Foundation (Days 1-2)

#### Task 1.1: Create Global Contract Document ✅ Ready to Start
**File:** `data/prompts/global-trace-contract.json`

```json
{
  "title": "Global Trace Coordination Contract",
  "memory": {
    "promptType": "global",
    "type": "semantic",
    "persona": [],
    "project": [],
    "tags": ["global", "trace-contract", "coordination"]
  },
  "contract": {
    "trace_discipline": [
      "Never invent IDs - only use provided {traceId, projectId, sessionId}",
      "Always include traceId in memory_store metadata",
      "Use exact traceId from context in all tool calls"
    ],
    "tool_sequence": [
      "1. memory_search with traceId to load context",
      "2. Execute your specialized work",
      "3. memory_store with traceId to save outputs",
      "4. handoff_to_agent with traceId to pass to next agent"
    ],
    "memory_tagging": {
      "required_fields": ["metadata.traceId", "persona", "project"],
      "content_format": "Single line summary (no newlines)",
      "tags": "Descriptive array: ['ideas', 'approved'] or ['scripts', 'validated']"
    },
    "handoff_discipline": [
      "Use handoff_to_agent tool (not memory_store)",
      "Include natural language instructions",
      "Tell next agent where to find your work",
      "Specify traceId explicitly"
    ],
    "error_handling": [
      "For blocking errors: handoff_to_agent({toAgent: 'error', instructions: 'details'})",
      "For completion: handoff_to_agent({toAgent: 'complete', instructions: 'summary'})",
      "Store error memories with tags: ['error', 'blocked']"
    ]
  }
}
```

#### Task 1.2: Create Comprehensive Tool Catalog ✅ Ready to Start
**File:** `data/prompts/mcp-tools-catalog.json`

Structure for each tool:
- Tool name
- Purpose (one sentence)
- When to use (bullet list)
- Required parameters
- Optional parameters
- Example JSON
- Returns
- Common errors

Tools to document:
- trace_create
- trace_update
- memory_search
- memory_store
- handoff_to_agent
- context_get_project
- context_get_persona
- job_upsert
- jobs_summary
- workflow_complete

---

### Phase 2: Create Missing Personas (Days 2-3)

#### Task 2.1: Create Veo (Production) Persona ⏸️ Blocked by Phase 1

**File:** `data/personas/veo.json`

**Key Sections:**
```json
{
  "title": "Veo - Production Agent · MCP Native",
  "agent": {
    "name": "Veo",
    "id": "veo",
    "title": "Production",
    "role": "Video generation coordinator",
    "expertise": [
      "Screenplay interpretation",
      "Video generation API orchestration",
      "Job status tracking",
      "Asset URL management",
      "Quality validation"
    ]
  },
  "workflow": {
    "steps": [
      {
        "order": 1,
        "action": "Load Riley's Scripts",
        "tool": "memory_search",
        "filters": {
          "traceId": "{from context}",
          "persona": "riley",
          "tags": ["screenplay", "validated"]
        },
        "success": "Found N screenplays matching project video count"
      },
      {
        "order": 2,
        "action": "Generate Videos",
        "method": "Call video generation API or toolWorkflow for each script",
        "tracking": "Use job_upsert to log each generation task",
        "success": "All videos generated, URLs captured"
      },
      {
        "order": 3,
        "action": "Store Video URLs",
        "tool": "memory_store",
        "content": "Generated {N} videos for {traceId}. URLs: {list}",
        "tags": ["video", "generated", "veo"],
        "metadata": {
          "traceId": "{from context}",
          "videoUrls": "{array}",
          "provider": "runway|shotstack|etc"
        }
      },
      {
        "order": 4,
        "action": "Validate Completion",
        "tool": "jobs_summary",
        "check": "pending === 0, all videos succeeded",
        "success": "All assets ready for editing"
      },
      {
        "order": 5,
        "action": "Handoff to Alex",
        "tool": "handoff_to_agent",
        "payload": {
          "toAgent": "alex",
          "traceId": "{from context}",
          "instructions": "Stitch {N} videos into compilation. Find URLs in memory (persona: veo, traceId: {traceId})."
        }
      }
    ]
  },
  "tools": {
    "memory_search": "Load Riley's validated screenplays",
    "memory_store": "Save video URLs and generation metadata",
    "job_upsert": "Track video generation jobs",
    "jobs_summary": "Validate all jobs completed before handoff",
    "handoff_to_agent": "Pass to Alex with clear instructions"
  },
  "systemPrompt": "You are Veo, the Production coordinator. Load Riley's screenplays, generate videos, track jobs, and hand off URLs to Alex. Never proceed until jobs_summary confirms all pending === 0."
}
```

#### Task 2.2: Create Alex (Editor) Persona ⏸️ Blocked by Phase 1

**File:** `data/personas/alex.json`

**Key Workflow:**
```
1. memory_search (traceId, persona: veo) → get video URLs
2. Call editing API/toolWorkflow → stitch compilation
3. job_upsert → track edit job
4. [HITL approval via Telegram node] → get user feedback
5. If approved: memory_store + handoff_to_agent(toAgent: quinn)
6. If rejected: regenerate with feedback, loop back to step 2
```

#### Task 2.3: Create Quinn (Publisher) Persona ⏸️ Blocked by Phase 1

**File:** `data/personas/quinn.json`

**Key Workflow:**
```
1. memory_search (traceId, persona: alex) → get final edit URL
2. Publish to TikTok/YouTube (via HTTP nodes)
3. memory_store → save publish URLs
4. handoff_to_agent(toAgent: "complete") → signal completion
5. Send user notification (Telegram message with results)
```

**Critical:** Quinn uses `toAgent: "complete"` to signal workflow completion. This sets trace status and unblocks Casey's wait loop.

---

### Phase 3: Update Existing Personas (Days 3-4)

#### Task 3.1: Update Casey Persona ⏸️ Blocked by Phase 1

**Changes Required:**
1. Replace long-form text with semantic workflow structure
2. Add explicit tool call sequences aligned with trace_prep flow
3. Emphasize `trace_create` → `context_get_project` → `context_get_persona` → `handoff_to_agent`
4. Remove orchestration language, emphasize "start and wait"
5. Add clear "Definition of Done" checklist
6. Simplify systemPrompt field to core identity + workflow reference

**New Structure:**
```json
{
  "systemPrompt": "You are Casey, the Showrunner. Your job: (1) load project context, (2) create trace, (3) brief Iggy, (4) go idle. Trust your team to execute autonomously. Quinn will signal completion.",
  "workflow": {
    "steps": [ /* detailed semantic workflow */ ]
  },
  "tools": { /* catalog with when/how/why */ },
  "validation_checklist": [ /* must-dos before handoff */ ]
}
```

#### Task 3.2: Update Iggy (IdeaGenerator) Persona ⏸️ Blocked by Phase 1

**Changes Required:**
1. Simplify uniqueness checking workflow
2. Align with trace-centric memory searches
3. Add clear handoff to Riley expectations
4. Remove overly complex graph traversal guidance (keep it optional)
5. Focus on semantic workflow: load context → generate → validate → store → handoff

#### Task 3.3: Update Riley (Screenwriter) Persona ⏸️ Blocked by Phase 1

**Changes Required:**
1. Add explicit traceId usage in all examples
2. Simplify spec loading (parallel memory_search calls)
3. Add clear handoff to Veo expectations
4. Align validation checklist with project guardrails
5. Remove spec lookup complexity, trust memory_search

---

### Phase 4: Enhance Projects (Days 4-5)

#### Task 4.1: Enhance AISMR Project

**Add:**
- Complete workflow array: `["casey", "iggy", "riley", "veo", "alex", "quinn"]`
- Detailed guardrails as structured JSON
- Agent-specific expectations (what each agent must deliver)
- Quality metrics and validation criteria
- Example outputs for each stage

#### Task 4.2: Enhance GenReact Project

**Add:**
- Detailed specs (generations array already exists)
- Guardrails for tone, cultural sensitivity, humor
- Agent-specific expectations
- Optional step logic (when to skip Alex)
- Example outputs

---

### Phase 5: Integration & Testing (Days 5-6)

#### Task 5.1: Update trace-prep.ts Prompt Builder

**Changes:**
```typescript
// Ensure global contract is prepended to all prompts
function buildPersonaPrompt(params) {
  const globalContract = loadGlobalContract(); // New function
  const toolCatalog = loadToolCatalog(params.personaName); // New function
  
  const promptPieces = [
    globalContract,
    params.personaPrompt || `You are ${params.trace.currentOwner}`,
    toolCatalog,
    // ... existing trace context, project, memories, instructions
  ];
  
  return promptPieces.filter(Boolean).join('\n\n');
}
```

#### Task 5.2: Test Prompt Delivery

**Test Cases:**
1. Casey receives correct prompt with project list
2. Iggy receives correct prompt with traceId and upstream memories
3. Riley receives correct prompt with Iggy's outputs
4. Veo receives correct prompt with Riley's screenplays
5. Alex receives correct prompt with Veo's video URLs
6. Quinn receives correct prompt with Alex's final edit

---

### Phase 6: Documentation & Rollout (Days 6-7)

#### Task 6.1: Update MCP_PROMPT_NOTES.md

Align with new structure:
- Reference global contract
- Update tool catalog section
- Add persona workflow summaries
- Update examples

#### Task 6.2: Update AGENTS.md

Add prompt architecture section referencing this plan

#### Task 6.3: Create Migration Guide

Document:
- What changed
- Why it changed
- How to verify prompts are working
- Troubleshooting common issues

---

## Success Criteria

### For Each Persona

- [ ] systemPrompt is concise, identity-focused (≤3 sentences)
- [ ] Workflow is step-by-step semantic (numbered, clear actions)
- [ ] Tools section lists every tool with when/how/why
- [ ] Validation checklist exists (5-7 items)
- [ ] Example tool calls are provided (JSON format)
- [ ] Handoff instructions are natural language and specific
- [ ] traceId is mentioned in every relevant section
- [ ] No ID invention, only use provided IDs

### For Projects

- [ ] workflow array is complete and correct
- [ ] optionalSteps documented with skip logic
- [ ] Guardrails are structured and actionable
- [ ] Agent expectations are explicit (inputs/outputs)
- [ ] Quality metrics defined
- [ ] Example outputs provided

### For Overall System

- [ ] Global contract loaded by all personas
- [ ] Tool catalog comprehensive (all 10+ tools)
- [ ] Prompt delivery tested end-to-end
- [ ] Casey → Iggy → Riley chain works
- [ ] Memory tagging consistent across all personas
- [ ] Handoffs execute correctly (tool called, not just logged)
- [ ] Confidence level: agents complete workflows without getting stuck

---

## Risk Mitigation

### Risk: Prompt Too Long

**Issue:** Concatenating global contract + persona prompt + tool catalog + context = >4000 tokens

**Mitigation:**
- Keep systemPrompt concise (core identity only)
- Load tool catalog dynamically based on allowedTools
- Limit upstream memories to 10 most recent
- Use summary format for project guardrails

### Risk: Agents Ignore Global Contract

**Issue:** Agents skip tool sequence or forget traceId

**Mitigation:**
- Repeat critical instructions in persona systemPrompt
- Add validation in trace_prep that checks outputs
- Monitor memory_store calls for missing traceId
- Add automated linting of agent outputs

### Risk: Persona Confusion

**Issue:** Agent doesn't understand its role in pipeline

**Mitigation:**
- Add "Your Place in Pipeline" section to every persona
- Explicitly state: "Position N of 6: [prev] → YOU → [next]"
- Include "You hand off to: [name]" reminder
- Show workflow position in runtime context

---

## Appendix: Tool Catalog Reference

### Core Tools (All Personas)

1. **memory_search** - Find relevant memories
2. **memory_store** - Save outputs with traceId
3. **handoff_to_agent** - Transfer ownership to next persona

### Casey-Specific Tools

4. **trace_create** - Create new production run
5. **trace_update** - Update trace metadata/instructions
6. **context_get_project** - Load project specs
7. **context_get_persona** - Load persona capabilities

### Veo/Alex-Specific Tools

8. **job_upsert** - Track video/edit jobs
9. **jobs_summary** - Check job completion status

### Quinn-Specific Tools

10. **workflow_complete** - Signal trace completion

---

## Next Steps

1. **Immediate:** Mark `prompt-audit` todo as in-progress
2. **Day 1:** Complete Phase 1 (global contract + tool catalog)
3. **Day 2-3:** Create missing personas (Veo, Alex, Quinn)
4. **Day 4:** Update existing personas (Casey, Iggy, Riley)
5. **Day 5:** Enhance projects (AISMR, GenReact)
6. **Day 6:** Integration testing
7. **Day 7:** Documentation and rollout

**Estimated Total Duration:** 7 days (including testing and documentation)

---

**Created by:** AI Development Agent  
**Review Required:** Yes - validate with North Star vision and Plan.md  
**Dependencies:** Epic 2 completion (universal workflow must be functional)

