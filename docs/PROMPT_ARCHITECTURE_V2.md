# Prompt Architecture V2: Separation of Concerns

**Date:** November 7, 2025  
**Status:** ✅ Architectural Decision  
**Principle:** Clear boundaries between personas, projects, and global rules

---

## Core Principle

> **Each component has ONE responsibility and ZERO overlap.**

```
Personas = WHO (role, capabilities, generic workflow)
Projects = WHAT (specs, guardrails, workflow order)
Global Contract = HOW (trace coordination, tool discipline)
```

---

## Component Boundaries

### 1. Global Contract (Universal)

**File:** `data/prompts/global-trace-contract.json`

**Responsibility:** Rules ALL agents must follow

**Contains:**
- Trace discipline (never invent IDs, always tag with traceId)
- Tool call sequence (search → work → store → handoff)
- Memory tagging requirements (format, required fields)
- Handoff discipline (tool vs memory, instruction quality)
- Error handling (when to use toAgent: 'error')

**Does NOT contain:**
- Project-specific rules (AISMR timing, GenReact generations)
- Persona-specific instructions (Iggy uniqueness, Riley validation)
- Tool usage details (handled by tool handlers)

---

### 2. Personas (Role Definitions)

**Files:** `data/personas/{casey,iggy,riley,veo,alex,quinn}.json`

**Responsibility:** Define WHO the agent is and their GENERIC workflow

**Contains:**
- Identity: "You are {name}, the {role}"
- Capabilities: What this persona is good at
- Generic workflow pattern:
  ```
  1. Load context (memory_search with traceId)
  2. Execute work (your expertise)
  3. Store outputs (memory_store with traceId)
  4. Handoff (handoff_to_agent with next agent)
  ```
- Tools available: allowedTools array
- Success criteria (generic)

**Does NOT contain:**
- AISMR-specific rules (8s duration, whisper at 3.0s, ≤2 hands)
- GenReact-specific rules (6 generations, cultural sensitivity)
- Project workflow order (who comes before/after you)
- Specific guardrails (those come from project)

**Example - Iggy (Project-Agnostic):**
```json
{
  "name": "iggy",
  "role": "Creative Director",
  "identity": "You generate creative concepts for video production projects.",
  "capabilities": [
    "Ideation and concept generation",
    "Uniqueness validation via memory search",
    "Quantity delivery (you generate the count the project specifies)",
    "Quality assessment (you validate against project guardrails)"
  ],
  "workflow": {
    "step_1": "Load upstream context (memory_search with traceId)",
    "step_2": "Check project specs for quantity/constraints",
    "step_3": "Generate concepts matching project requirements",
    "step_4": "Validate uniqueness against archive",
    "step_5": "Store outputs (memory_store with traceId)",
    "step_6": "Handoff to next agent per project workflow"
  },
  "allowedTools": ["memory_search", "memory_store", "handoff_to_agent"]
}
```

---

### 3. Projects (Requirements)

**Files:** `data/projects/{aismr,genreact}.json`

**Responsibility:** Define WHAT to produce and HOW to validate it

**Contains:**
- Project description (what we're making)
- Workflow order: `["casey", "iggy", "riley", "veo", "alex", "quinn"]`
- Optional steps: `["alex"]` (can be skipped)
- Specs (project-specific numbers):
  ```json
  {
    "videoCount": 12,
    "videoDuration": 8.0,
    "whisperTiming": 3.0,
    "maxHands": 2,
    "compilationLength": 110
  }
  ```
- Guardrails (project-specific rules):
  ```json
  {
    "timing": "Strict 8.0s runtime, whisper at 3.0s ±0.05s",
    "hands": "Maximum 2 hands visible at any time",
    "audio": "No music, ambient sound only, tactile foley required",
    "style": "Surreal, impossible physics, tactile focus"
  }
  ```
- Agent expectations (what each agent should deliver):
  ```json
  {
    "iggy": "12 surreal modifiers with uniqueness validation",
    "riley": "12 validated screenplays, 8.0s each, whisper at 3.0s",
    "veo": "12 video URLs, all jobs succeeded",
    "alex": "1 final edit URL, ~110s compilation",
    "quinn": "Published URL + platform confirmation"
  }
  ```

**Does NOT contain:**
- Persona identities (who Iggy is)
- Generic workflow patterns (search → work → store → handoff)
- Trace coordination rules (those are in global contract)

**Example - AISMR Project:**
```json
{
  "name": "aismr",
  "description": "8-second micro-films of everyday objects with surreal modifiers",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": [],
  "specs": {
    "videoCount": 12,
    "videoDuration": 8.0,
    "whisperTiming": 3.0,
    "maxHands": 2,
    "compilationLength": 110,
    "format": "9:16 vertical, single-shot"
  },
  "guardrails": {
    "timing": {
      "runtime": "Exactly 8.0s ±0.1s",
      "whisper": "At 3.0s ±0.05s",
      "validation": "Riley must validate before storing"
    },
    "visual": {
      "hands": "Maximum 2 hands visible",
      "camera": "Single continuous shot, no cuts",
      "focus": "Macro, tactile, object-centric"
    },
    "audio": {
      "music": "Forbidden",
      "voice": "Single whispered word at 3.0s",
      "foley": "Required, tactile, realistic"
    },
    "style": {
      "modifiers": "Surreal, impossible physics",
      "mood": "Mesmerizing, slightly unsettling",
      "originality": "Must validate uniqueness"
    }
  },
  "agent_expectations": {
    "iggy": {
      "output": "12 surreal object modifiers",
      "validation": "Uniqueness checked against archive",
      "format": "Modifier name + brief description"
    },
    "riley": {
      "output": "12 screenplays with timing/hand/audio validation",
      "validation": "All specs pass before storage",
      "format": "Timestamp-based shot list"
    },
    "veo": {
      "output": "12 video URLs from generation API",
      "validation": "All jobs succeeded (jobs_summary)",
      "tracking": "Use job_upsert for each video"
    },
    "alex": {
      "output": "1 compilation video URL (~110s)",
      "validation": "User approval via HITL",
      "format": "Sequential with title cards"
    },
    "quinn": {
      "output": "Published URL + platform confirmation",
      "validation": "Upload succeeded",
      "platforms": ["tiktok"]
    }
  }
}
```

---

## How They Combine at Runtime

### Prompt Assembly in trace_prep

```typescript
function buildPersonaPrompt(params: {
  personaName: string;
  trace: Trace;
  project: Project;
  memories: Memory[];
}): string {
  
  // 1. Load global contract (universal rules)
  const globalContract = loadGlobalContract();
  
  // 2. Load persona (who you are, generic workflow)
  const persona = loadPersona(params.personaName);
  
  // 3. Load project (what to make, specific rules)
  const project = params.project;
  
  // 4. Assemble context
  const context = {
    traceId: params.trace.traceId,
    currentOwner: params.trace.currentOwner,
    instructions: params.trace.instructions,
    upstreamWork: formatMemories(params.memories)
  };
  
  // 5. Combine into final prompt
  return `
${globalContract}

${persona.identity}

YOUR ROLE: ${persona.role}
YOUR CAPABILITIES: ${persona.capabilities.join(', ')}

CURRENT PROJECT: ${project.name}
PROJECT DESCRIPTION: ${project.description}

PROJECT SPECS YOU MUST FOLLOW:
${JSON.stringify(project.specs, null, 2)}

PROJECT GUARDRAILS YOU MUST VALIDATE:
${JSON.stringify(project.guardrails, null, 2)}

WHAT THIS PROJECT EXPECTS FROM YOU (${params.personaName}):
${JSON.stringify(project.agent_expectations[params.personaName], null, 2)}

YOUR WORKFLOW (generic pattern):
${persona.workflow}

TRACE ID: ${context.traceId}
**CRITICAL**: Use this EXACT traceId in all tool calls. Never create or modify it.

YOUR INSTRUCTIONS: ${context.instructions}

UPSTREAM WORK:
${context.upstreamWork}

YOUR TOOLS: ${persona.allowedTools.join(', ')}
(Tool descriptions available when you call them)

NOW: Follow your workflow, use the tools, validate against project specs, and handoff when done.
`;
}
```

---

## Benefits of This Architecture

### 1. Reusability

**Personas are reusable:**
```
Iggy can work on:
- AISMR (12 surreal modifiers, tactile focus)
- GenReact (6 generational scenarios, cultural sensitivity)
- Future projects (N concepts, any constraints)

Same Iggy identity/workflow, different project specs.
```

**Projects are reusable:**
```
AISMR can use:
- Current team: Casey → Iggy → Riley → Veo → Alex → Quinn
- Future team: Casey → NewIdeator → Riley → Veo → Quinn (skip Alex)
- Alt team: Casey → Iggy → NewWriter → Veo → Alex → Quinn

Same AISMR specs, different personas.
```

### 2. Maintainability

**Change project specs:**
```
Update: data/projects/aismr.json
Effect: All personas immediately use new specs
No changes needed: Persona prompts stay the same
```

**Change persona workflow:**
```
Update: data/personas/iggy.json
Effect: Iggy uses new pattern on all projects
No changes needed: Project specs stay the same
```

### 3. Clarity

**Each file has ONE job:**
- Global contract: Universal rules
- Persona: Role and generic workflow
- Project: Specs and guardrails

**No overlap, no confusion.**

---

## Migration from Current State

### Before (Mixed Concerns)

**Old Casey:**
```json
{
  "agent": {
    "whentouse": "Coordinate production kickoff for AISMR..." // ❌ Project-specific
  },
  "tools": {
    "trace_create": {
      "example": {
        "projectId": "aismr" // ❌ Project-specific
      }
    }
  },
  "workflow": {
    "instructions": "Generate 12 surreal modifiers..." // ❌ Project-specific
  }
}
```

### After (Separated Concerns)

**New Casey (Project-Agnostic):**
```json
{
  "name": "casey",
  "role": "Showrunner",
  "identity": "You coordinate production runs. You start them, then trust your team to execute.",
  "workflow": {
    "step_1": "Load project context (context_get_project)",
    "step_2": "Load next agent capabilities (context_get_persona)",
    "step_3": "Create trace (trace_create)",
    "step_4": "Store kickoff memory (memory_store)",
    "step_5": "Handoff to first agent in project.workflow (handoff_to_agent)"
  }
}
```

**AISMR Project (Casey's Expectations):**
```json
{
  "name": "aismr",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "agent_expectations": {
    "casey": {
      "output": "Trace created, kickoff logged, handoff to iggy",
      "instructions_template": "Generate {videoCount} surreal modifiers for {object}. Validate uniqueness, seek approval, hand to Riley."
    }
  }
}
```

---

## Implementation Plan (Revised)

### Phase 1: ✅ COMPLETE
- [x] Global contract created
- [x] Architecture document created

### Phase 2: Rewrite Personas (Project-Agnostic)
1. Casey - Generic showrunner workflow
2. Iggy - Generic ideation workflow
3. Riley - Generic writing workflow
4. Veo - Generic production workflow (NEW)
5. Alex - Generic editing workflow (NEW)
6. Quinn - Generic publishing workflow (NEW)

### Phase 3: Enhance Projects (Persona-Agnostic)
1. AISMR - Complete specs, guardrails, agent expectations
2. GenReact - Complete specs, guardrails, agent expectations

### Phase 4: Update trace-prep.ts
- Load global contract
- Load persona (generic)
- Load project (specific)
- Combine properly

### Phase 5: Test & Document
- Test Casey → Iggy → Riley chain
- Update MCP_PROMPT_NOTES.md
- Document architecture

---

## File Structure (Clean)

```
data/
├── prompts/
│   └── global-trace-contract.json          ← Universal rules
├── personas/
│   ├── casey.json                          ← Project-agnostic role
│   ├── iggy.json                           ← Project-agnostic role
│   ├── riley.json                          ← Project-agnostic role
│   ├── veo.json                            ← Project-agnostic role (NEW)
│   ├── alex.json                           ← Project-agnostic role (NEW)
│   └── quinn.json                          ← Project-agnostic role (NEW)
└── projects/
    ├── aismr.json                          ← Persona-agnostic specs
    ├── genreact.json                       ← Persona-agnostic specs
    └── general.json                        ← Persona-agnostic specs
```

**Tool catalog:** ❌ DELETED (redundant with tool handler descriptions)

---

**Status:** ✅ Architecture Defined - Ready to Implement  
**Next:** Rewrite personas with clear separation of concerns

