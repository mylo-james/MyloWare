# The North Star V2: Trace-Driven AI Production Studio

> **"One workflow. One webhook. Infinite personas. From a text message to a published video—orchestrated by a self-discovering agent system."**

---

## 🌟 The Vision

Send a text: "Make an AISMR video about candles." Minutes later, watch as a stunning 110-second compilation goes live on TikTok. Or say: "Make a video about how generations react to AI," and get a perfectly-crafted 6-generation reaction video.

No complex commands. No coordination overhead. Just **ONE universal workflow** that morphs into any persona, discovers its role from the trace, executes autonomously, and hands off seamlessly.

**This is V2: A self-discovering, trace-driven agent system where the workflow itself becomes any agent it needs to be.**

---

## 🎯 Core Architecture Principles

### 1. ONE Workflow for ALL Personas

Instead of 6 separate workflows, we have **one workflow** (`myloware-agent.workflow.json`) that:

- Accepts a `traceId` (or creates one from user messages)
- Queries the trace to discover which persona it should become
- Loads that persona's configuration and executes as that agent
- Hands off to the same workflow with a new traceId

### Quick Code Entry Points

Jump straight into the implementation with these anchors:

- `src/api/routes/trace-prep.ts` – Fastify route that exposes `/mcp/trace_prep` to n8n
- `src/utils/trace-prep.ts` – `prepareTraceContext()` and `loadProjectPlaybooks()` prompt assembly
- `src/mcp/tools.ts` – Full MCP tool catalog, including terminal logic in `handoff_to_agent`
- `workflows/myloware-agent.workflow.json` – The universal n8n workflow (Edit Fields → trace_prep → AI Agent)

### 2. Trace as State Machine

The `execution_traces` table is the single source of truth:

```typescript
{
  traceId: "trace-aismr-001",
  projectId: "aismr",                    // Which project
  currentOwner: "riley",                 // Who owns it now
  instructions: "Write 12 screenplays",  // What they should do
  workflowStep: 2,                       // Position in workflow
  sessionId: "telegram:123",             // User session
  status: "active",                      // active | completed | failed
  previousOwner: "iggy"                  // History
}
```

### 3. Projects Define Workflows

Projects specify the pipeline:

```json
{
  "name": "aismr",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": [],
  "videoCount": 12,
  "videoDuration": 8.0,
  "guardrails": "..."
}

{
  "name": "genreact",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": ["alex"],  // Editing can be skipped
  "videoCount": 6,
  "videoDuration": 8.0,
  "guardrails": "..."
}
```

### 4. Handoff = Update Trace + Invoke Same Webhook

When an agent hands off:

```typescript
await handoff_to_agent({
  traceId: 'trace-aismr-001',
  toAgent: 'riley',
  instructions: 'Write 12 screenplays for candles',
});

// This:
// 1. Updates trace: currentOwner = "riley", workflowStep++
// 2. Stores handoff memory tagged with traceId
// 3. Invokes Myloware Agent webhook with { traceId }
// 4. Returns immediately (non-blocking)
```

### 5. Special Handoff Targets

Two special targets mark completion/failure:

- **`toAgent: "complete"`** → Sets trace status = 'completed', no webhook invoked
- **`toAgent: "error"`** → Sets trace status = 'failed', no webhook invoked

---

## 🎭 The Workflow Structure

### The Myloware Agent Workflow

```
┌──────────────────────────────────────────────────────────────────┐
│           myloware-agent.workflow.json (ONE FILE)                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────┐          │
│  │  Telegram   │   │    Chat     │   │   Webhook    │          │
│  │  Trigger    │   │   Trigger   │   │   Trigger    │          │
│  └──────┬──────┘   └──────┬──────┘   └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            ↓                                     │
│                  ┌──────────────────┐                            │
│                  │   Edit Fields    │                            │
│                  ├──────────────────┤                            │
│                  │ Extract traceId  │                            │
│                  │ if present       │                            │
│                  └────────┬─────────┘                            │
│                           ↓                                      │
│                  ┌──────────────────┐                            │
│                  │   trace_prep     │                            │
│                  │   (HTTP Request) │                            │
│                  ├──────────────────┤                            │
│                  │ ONE call that:   │                            │
│                  │ • Creates trace  │                            │
│                  │   if missing     │                            │
│                  │ • Loads persona  │                            │
│                  │ • Gets project   │                            │
│                  │ • Searches memory│                            │
│                  │ • Builds prompt  │                            │
│                  │ • Returns tools  │                            │
│                  └────────┬─────────┘                            │
│                           ↓                                      │
│                  ┌──────────────────┐                            │
│                  │   AI Agent Node  │                            │
│                  ├──────────────────┤                            │
│                  │ Prompt: {{prep}} │                            │
│                  │ Tools: {{tools}} │                            │
│                  │                  │                            │
│                  │ Personifies:     │                            │
│                  │ • Casey          │                            │
│                  │ • Iggy           │                            │
│                  │ • Riley          │                            │
│                  │ • Veo            │                            │
│                  │ • Alex           │                            │
│                  │ • Quinn          │                            │
│                  │                  │                            │
│                  │ Calls tools:     │                            │
│                  │ • memory_store   │                            │
│                  │ • handoff_to_agent│                           │
│                  └────────┬─────────┘                            │
│                           ↓                                      │
│              (Handoff updates DB & invokes SAME workflow)        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

✓ ONE workflow morphs into ANY persona
✓ trace_prep does ALL preprocessing in one call
✓ Handoff tool creates self-referential loop
✓ Simple 3-node pattern: Edit → Prep → Agent
```

---

## 🎬 Story 1: AISMR Happy Path

### User Request (8:00 PM)

```
Telegram → Casey
Mylo: "Make an AISMR video about candles"
```

### Step 1: Casey Initialization

```typescript
// ========================================
// MYLOWARE AGENT - Telegram Trigger
// ========================================

// Input: { message: "Make an AISMR video about candles", userId: "123" }

// INITIALIZATION NODE
// No traceId provided → Create new trace
const { traceId } = await trace_create({
  projectId: 'unknown', // Casey will determine this
  sessionId: 'telegram:123',
  currentOwner: 'casey', // Default persona
  instructions: 'Make an AISMR video about candles',
  workflowStep: 0,
});
// Returns: traceId = "trace-001"

// ========================================
// PREPROCESSING NODE (trace_prep HTTP call)
// ========================================
const prep = await httpRequest('POST', '/mcp/trace_prep', {
  traceId: traceId,
  source: 'telegram',
  sessionId: 'telegram:123',
});

// trace_prep returns:
// {
//   traceId: "trace-001",
//   systemPrompt: "You are Casey, the Showrunner...",
//   allowedTools: ["trace_update", "memory_search", "memory_store", "handoff_to_agent"],
//   instructions: "Make an AISMR video about candles",
//   memories: []
// }

// Project is 'unknown' → trace_prep built Casey initialization prompt:
const systemPrompt = prep.systemPrompt;
// `You are Casey, the Showrunner.
//
// USER MESSAGE: "Make an AISMR video about candles"
//
// TASK:
// 1. Determine which project this is for:
//    - "aismr": Surreal object videos, 12 modifiers, 8s each
//    - "genreact": Generational reactions, 6 scenarios, 8s each
//
// 2. Use trace_update to set the projectId
// 3. Store a kickoff memory
// 4. Use handoff_to_agent to pass to the first agent in the workflow
//
// You have access to: trace_update, memory_search, memory_store, handoff_to_agent`

// ========================================
// AI AGENT NODE (becomes Casey)
// ========================================
// Casey executes:

// 1. Determine project
// Message mentions "AISMR" → project = "aismr"

await trace_update({
  traceId: 'trace-001',
  projectId: 'aismr',
});

// 2. Store kickoff memory
await memory_store({
  content:
    'User requested AISMR video about candles. Project: aismr, starting workflow.',
  memoryType: 'episodic',
  persona: ['casey'],
  project: ['aismr'],
  metadata: { traceId: 'trace-001', object: 'candles' },
});

// 3. Handoff to Iggy (first agent in AISMR workflow)
await handoff_to_agent({
  traceId: 'trace-001',
  toAgent: 'iggy',
  instructions:
    'Generate 12 surreal modifiers for candles. Validate uniqueness against archive.',
});

// handoff_to_agent updates trace:
// - currentOwner = "iggy"
// - workflowStep = 1
// - instructions = "Generate 12 surreal modifiers..."
// - Invokes Myloware Agent webhook with { traceId: "trace-001" }

// ========================================
// CASEY'S COMPLETION SIGNAL
// ========================================
// Casey's job ends after handoff to Iggy. When Quinn calls
// handoff_to_agent({ toAgent: 'complete' }), the tool automatically:
// 1. Sets trace status to 'completed'
// 2. Extracts publish URL from instructions
// 3. Sends Telegram notification to user directly
// 4. No polling required - notification is immediate
//
// This is simpler and more efficient than the polling pattern.
```

### Step 2: Iggy (Creative Director)

**8:00 PM + 500ms - Myloware Agent webhook receives { traceId: "trace-001" }**

```typescript
// ========================================
// MYLOWARE AGENT - Webhook Trigger
// ========================================

// Input: { traceId: "trace-001" }

// INITIALIZATION NODE
// traceId provided → Use existing trace

// ========================================
// PREPROCESSING NODE (trace_prep HTTP call)
// ========================================
const prep = await httpRequest('POST', '/mcp/trace_prep', {
  traceId: 'trace-001',
});

// trace_prep returns everything assembled:
// {
//   traceId: "trace-001",
//   systemPrompt: "You are Iggy, Creative Director...",
//   allowedTools: ["memory_search", "memory_store", "handoff_to_agent"],
//   instructions: "Generate 12 surreal modifiers for candles...",
//   memories: [{ content: "User requested AISMR candles video", persona: "casey", ... }]
// }

// systemPrompt already contains:
// - Iggy's persona prompt
// - AISMR project specs
// - Workflow position (step 1 of 6)
// - Next agent (riley)
// - Instructions from Casey
// - All upstream memories
const systemPrompt = prep.systemPrompt;
// `You are Iggy, Creative Director.
//
// PROJECT: AISMR
// - Generate 12 surreal modifiers for objects
// - Each becomes an 8s video
// - Validate uniqueness against archive
// - Examples: Void, Liquid, Crystal, Shadow
//
// CURRENT WORKFLOW STEP: 1 of 6 (iggy)
// NEXT AGENT: riley
//
// INSTRUCTIONS: Generate 12 surreal modifiers for candles. Validate uniqueness against archive.
//
// UPSTREAM WORK:
// - Casey: User requested AISMR candles video
//
// When done:
// 1. Store your outputs via memory_store
// 2. Call handoff_to_agent to next agent: "riley"`

// ========================================
// AI AGENT NODE (becomes Iggy)
// ========================================
// MCP Tools: ["memory_search", "memory_store", "handoff_to_agent"]

// 1. Search for uniqueness
const pastIdeas = await memory_search({
  query: 'AISMR candles past modifiers',
  memoryType: 'episodic',
  project: 'aismr',
});
// Found: "Fire candle" and "Melting candle" used before

// 2. Generate 12 unique modifiers
const modifiers = [
  'Void Candle - Flame absorbs light',
  'Liquid Candle - Wax flows upward',
  'Crystal Candle - Transparent with inner glow',
  'Shadow Candle - Made of shadow, casts light',
  'Smoke Candle - Solid smoke pillar',
  'Frozen Candle - Ice cold but burns',
  'Electric Candle - Lightning through wax',
  'Magnetic Candle - Iron filings dance',
  'Holographic Candle - Glitching projection',
  'Obsidian Candle - Volcanic glass, magma core',
  'Ethereal Candle - Translucent ghost-like',
  'Mirror Candle - Reflective, infinite flames',
];

// 3. Store outputs
await memory_store({
  content:
    'Generated 12 surreal candle modifiers for AISMR: Void, Liquid, Crystal, Shadow, Smoke, Frozen, Electric, Magnetic, Holographic, Obsidian, Ethereal, Mirror',
  memoryType: 'episodic',
  persona: ['iggy'],
  project: ['aismr'],
  tags: ['ideas-generated', 'candles'],
  metadata: {
    traceId: 'trace-001',
    object: 'candles',
    modifiers: modifiers,
    uniquenessChecked: true,
  },
});

// 4. Handoff to Riley (next in workflow)
await handoff_to_agent({
  traceId: 'trace-001',
  toAgent: 'riley', // From project.workflow[workflowStep + 1]
  instructions:
    'Write 12 screenplays for the candle modifiers I generated. Each should be 8.0s, AISMR format. Find modifiers in memory tagged with trace-001 and persona iggy.',
});

// handoff_to_agent updates trace:
// - currentOwner = "riley"
// - workflowStep = 2
// - instructions = "Write 12 screenplays..."
// - Invokes SAME webhook with { traceId: "trace-001" }
```

**Note:** Iggy workflow could include HITL (Telegram "Send and Wait") node for user approval before handoff. This is configured in n8n, not in the agent logic.

---

### Step 3: Riley (Head Writer)

**8:01 PM - Myloware Agent webhook receives { traceId: "trace-001" }**

```typescript
// ========================================
// PREPROCESSING NODE
// ========================================
const trace = await trace_prepare({ traceId: "trace-001" });
// { currentOwner: "riley", projectId: "aismr", instructions: "Write 12 screenplays...", workflowStep: 2 }

const persona = await context_get_persona({ name: "riley" });
const project = await context_get_project({ projectId: "aismr" });
const memories = await memory_search({ traceId: "trace-001", project: "aismr" });
// Finds: Casey's kickoff + Iggy's 12 modifiers

const systemPrompt = `
You are Riley, Head Writer.

PROJECT: AISMR
- Write 8.0s screenplays
- Whisper at 3.0s
- Max 2 hands
- No music, ambient only
- Validate all specs

CURRENT WORKFLOW STEP: 2 of 6 (riley)
NEXT AGENT: veo

INSTRUCTIONS: Write 12 screenplays for the candle modifiers I generated...

UPSTREAM WORK:
- Casey: User requested AISMR candles video
- Iggy: Generated 12 modifiers: Void, Liquid, Crystal, Shadow...

When done:
1. Store your screenplays via memory_store
2. Call handoff_to_agent to "veo"
`;

// ========================================
// AI AGENT NODE (becomes Riley)
// ========================================
// MCP Tools: ["memory_search", "memory_store", "handoff_to_agent"]

// 1. Load Iggy's modifiers from memory
const iggyModifiers = await memory_search({
  query: 'trace-001 iggy candle modifiers',
  memoryType: 'episodic',
  project: 'aismr'
});

// 2. Write 12 screenplays (validated)
// ... screenplay generation ...

// 3. Validate each against AISMR specs
// All pass ✓

// 4. Store screenplays
await memory_store({
  content: "Wrote 12 validated AISMR screenplays for candle modifiers. All pass timing, hand count, and audio specs.",
  memoryType: "episodic",
  persona: ["riley"],
  project: ["aismr"],
  metadata: {
    traceId: "trace-001",
    screenplays: [...],
    allValidated: true
  }
});

// 5. Handoff to Veo
await handoff_to_agent({
  traceId: "trace-001",
  toAgent: "veo",
  instructions: "Generate 12 videos from my screenplays. All are validated and ready. Generate in parallel/batch. Find screenplays in memory tagged trace-001 riley."
});

// Updates trace: currentOwner = "veo", workflowStep = 3
// Invokes SAME webhook with { traceId: "trace-001" }
```

---

### Step 4: Veo (Production)

**8:03 PM - Myloware Agent receives { traceId: "trace-001" }**

```typescript
// ========================================
// PREPROCESSING NODE
// ========================================
// trace.currentOwner = "veo"
// Builds Veo's prompt with Riley's screenplays from memory

// ========================================
// AI AGENT NODE (becomes Veo)
// ========================================
// Note: Veo might be a simpler n8n workflow that just:
// 1. Loads screenplays from memory
// 2. Calls external video generation API (HTTP Request nodes)
// 3. Polls for completion
// 4. Stores video URLs in memory
// 5. Hands off to Alex

// Or could be an AI agent that orchestrates the video generation

// Generates 12 videos...
// Stores URLs in memory...

await handoff_to_agent({
  traceId: 'trace-001',
  toAgent: 'alex',
  instructions:
    'Edit the 12 candle videos into compilation. AISMR style: sequential with title cards. ~110s total. Find video URLs in memory trace-001 veo.',
});

// Updates trace: currentOwner = "alex", workflowStep = 4
```

---

### Step 5: Alex (Editor)

**8:06 PM - Myloware Agent receives { traceId: "trace-001" }**

```typescript
// ========================================
// PREPROCESSING NODE
// ========================================
// trace.currentOwner = "alex"
// Builds Alex's prompt with Veo's video URLs from memory

// ========================================
// AI AGENT NODE (becomes Alex)
// ========================================
// Loads videos from memory...
// Edits compilation...
// Stores final video URL...

await handoff_to_agent({
  traceId: 'trace-001',
  toAgent: 'quinn',
  instructions:
    'Publish the AISMR candles compilation to TikTok. User approved. Find final video URL in memory trace-001 alex.',
});

// Updates trace: currentOwner = "quinn", workflowStep = 5
```

**Note:** Alex workflow could include HITL (Telegram "Send and Wait") for user to review final video before handoff to Quinn.

---

### Step 6: Quinn (Publisher)

**8:08 PM - Myloware Agent receives { traceId: "trace-001" }**

```typescript
// ========================================
// PREPROCESSING NODE
// ========================================
// trace.currentOwner = "quinn"
// Builds Quinn's prompt with Alex's final video from memory

// ========================================
// AI AGENT NODE (becomes Quinn)
// ========================================
// Loads final video from memory...
// Generates caption and hashtags...
// Uploads to TikTok...

await memory_store({
  content: "Published AISMR candles compilation to TikTok successfully",
  memoryType: "episodic",
  persona: ["quinn"],
  project: ["aismr"],
  metadata: {
    traceId: "trace-001",
    postUrl: "https://tiktok.com/@mylo_aismr/video/7234567890",
    platform: "tiktok"
  }
});

// Quinn hands off to special target "complete"
await handoff_to_agent({
  traceId: "trace-001",
  toAgent: "complete",  // Special target
  instructions: "Workflow complete. Published to TikTok."
});

// handoff_to_agent sees toAgent === "complete":
// - Sets trace.status = "completed"
// - Sets trace.completedAt = now
// - Does NOT invoke webhook
// - Returns immediately

// ========================================
// COMPLETION NOTIFICATION
// ========================================
// handoff_to_agent({ toAgent: 'complete' }) automatically:
// - Sets trace.status = "completed"
// - Extracts publish URL from instructions
// - Sends Telegram notification directly to user:

"🎉 Your AISMR candles video is live!
Watch: https://tiktok.com/@mylo_aismr/video/7234567890

✨ 12 surreal variations
⏱️ 110 seconds total
🚀 Published with optimized caption

Want to create another?"
```

---

## 🎬 Story 2: GenReact with Optional Step Skip

### User Request (9:00 PM)

```
Telegram → Casey
Mylo: "Make a simple video about generations reacting to AI"
```

### Casey Initialization

```typescript
// Casey determines project from "generations" keyword
await trace_update({ traceId: 'trace-002', projectId: 'genreact' });

await handoff_to_agent({
  traceId: 'trace-002',
  toAgent: 'iggy',
  instructions:
    'Generate 6 generational scenarios about reacting to AI. One scenario per generation: Silent, Boomer, Gen X, Millennial, Gen Z, Alpha.',
});
```

### Iggy → Riley → Veo

```typescript
// Standard flow through:
// Iggy: Generates 6 scenarios
// Riley: Writes 6 screenplays
// Veo: Generates 6 videos

// All perfect on first try!
```

### Veo Decides to Skip Alex

```typescript
// Veo finishes generating 6 videos
// Checks project.optionalSteps = ["alex"]

// User said "simple video" in original request
// Veo determines: Videos are already good quality, no editing needed

// Option 1: Handoff directly to Quinn (skip Alex)
await handoff_to_agent({
  traceId: 'trace-002',
  toAgent: 'quinn', // Skip alex
  instructions:
    "Publish 6 generation videos to TikTok. Videos don't need editing, already sequential. Find video URLs in memory trace-002 veo.",
});
// Updates: currentOwner = "quinn", workflowStep = 5 (skipped 4)

// Option 2: Still go to Alex but Alex quickly passes through
// (Depends on how smart we want the agents to be about skipping)
```

### Quinn Publishes

```typescript
// Quinn publishes videos
await handoff_to_agent({
  traceId: 'trace-002',
  toAgent: 'complete',
  instructions: 'GenReact video published successfully',
});

// Casey notifies user: "Your GenReact video is live!"
```

---

## ⚠️ Story 3: Error Handling

### Riley Validation Failure

```typescript
// Riley is writing screenplays
// Screenplay #4 fails validation (8.5s instead of 8.0s)

// Riley handles it internally:
// 1. Detects validation failure
// 2. Regenerates screenplay #4 with tighter timing
// 3. Re-validates → passes
// 4. Continues to handoff (user never sees the error)

await memory_store({
  content:
    'Screenplay #4 validation failed (8.5s), regenerated successfully to 8.0s',
  memoryType: 'episodic',
  persona: ['riley'],
  project: ['aismr'],
  tags: ['error-corrected', 'validation-retry'],
  metadata: { traceId: 'trace-001', retryCount: 1 },
});
```

### Veo Content Policy Failure

```typescript
// Veo attempts to generate Electric Book video
// API returns content policy violation

// Veo needs screenplay revision
// Option 1: Handoff back to Riley (smart routing)
await handoff_to_agent({
  traceId: 'trace-001',
  toAgent: 'riley',
  instructions:
    'Revise Electric Book screenplay - content policy flagged lightning effects as too intense. Reduce intensity, use subtle glow. Then regenerate video.',
});
// Trace goes back: currentOwner = "riley", workflowStep stays at 2 (Riley's step)

// Option 2: Handoff to error
await handoff_to_agent({
  traceId: 'trace-001',
  toAgent: 'error',
  instructions:
    'Content policy violation on Electric Book - unable to generate video',
});
// Sets trace.status = "failed", Casey's loop unblocks, user notified
```

---

## 🏗️ The Three-Node Workflow Pattern

Every agent execution follows this simple pattern:

```
┌─────────────────────────────────────┐
│  1. EDIT FIELDS NODE                │
│                                     │
│  • Extract traceId from input       │
│  • Pass through if present          │
│  • Set to null if missing           │
│                                     │
│  Output: { traceId?, input }        │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  2. TRACE_PREP (HTTP Request)       │
│                                     │
│  ONE call that does ALL:            │
│  • Creates trace if missing         │
│  • Loads trace.currentOwner         │
│  • Gets persona config              │
│  • Gets project config              │
│  • Searches memories by traceId     │
│  • Builds complete system prompt    │
│  • Returns allowed tools list       │
│                                     │
│  Output: { systemPrompt,            │
│            allowedTools,            │
│            traceId }                │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  3. AI AGENT NODE                   │
│                                     │
│  System Prompt: {{systemPrompt}}    │
│  MCP Tools: {{allowedTools}}        │
│                                     │
│  Agent:                             │
│  • Executes work                    │
│  • Calls memory_store               │
│  • Calls handoff_to_agent           │
│                                     │
│  (Handoff updates DB & triggers     │
│   SAME workflow via webhook)        │
└─────────────────────────────────────┘
```

**Key Insights:**

- No postprocessing needed! Agents call handoff directly
- trace_prep consolidates ALL preprocessing in one HTTP call
- Self-referential: handoff_to_agent calls back to webhook

---

## 📊 Project Configuration Examples

### AISMR Project

```json
{
  "id": "aismr",
  "name": "AISMR - Surreal Object Videos",
  "description": "8-second micro-films of everyday objects with impossible modifiers",

  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": [],

  "specs": {
    "videoCount": 12,
    "videoDuration": 8.0,
    "whisperTiming": 3.0,
    "maxHands": 2,
    "compilationLength": 110,
    "format": "sequential_with_titles"
  },

  "guardrails": {
    "audio": "ambient_only_no_music",
    "style": "surreal_impossible_modifiers",
    "validation": "strict_timing_hand_count"
  },

  "hitlPoints": ["after_modifiers", "before_upload"]
}
```

### GenReact Project

```json
{
  "id": "genreact",
  "name": "GenReact - Generational Reactions",
  "description": "How each generation reacts to modern situations",

  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": ["alex"], // Editing can be skipped for simple requests

  "specs": {
    "videoCount": 6,
    "videoDuration": 8.0,
    "generations": ["Silent", "Boomer", "GenX", "Millennial", "GenZ", "Alpha"],
    "compilationLength": 54,
    "format": "generation_labels"
  },

  "guardrails": {
    "tone": "humorous_but_respectful",
    "accuracy": "culturally_accurate_age_appropriate",
    "style": "light_observational_comedy"
  },

  "hitlPoints": ["after_scenarios", "before_upload"]
}
```

---

## 🔧 Tool Architecture

### Tool Access by Persona

All agents get the **same core tools**:

```typescript
// Standard agent tools
allowedTools: ['memory_search', 'memory_store', 'handoff_to_agent'];

// Casey gets one extra tool
allowedTools: [
  'trace_update',
  'memory_search',
  'memory_store',
  'handoff_to_agent',
];
```

### Special Handoff Targets

```typescript
// Normal handoffs
await handoff_to_agent({ toAgent: "riley", ... });
// → Updates trace ownership
// → Invokes Myloware Agent webhook

// Completion
await handoff_to_agent({ toAgent: "complete", ... });
// → Sets trace.status = "completed"
// → Extracts publish URL from instructions
// → Sends Telegram notification to user directly
// → NO webhook invoked (completion is terminal)

// Error handling
await handoff_to_agent({ toAgent: "error", ... });
// → Sets trace.status = "failed"
// → NO webhook invoked (error is terminal)
```

### trace_update Tool (Casey Only)

Casey uses this to set the project when it starts as 'unknown':

```typescript
// Trace created with projectId = 'unknown'
await trace_update({
  traceId: 'trace-001',
  projectId: 'aismr', // Casey determined from user message
});

// Now preprocessing can load project config
```

---

## 🎯 Key Architectural Decisions

### ✅ Single Workflow File

**What it means:**

- ONE file: `myloware-agent.workflow.json`
- ONE webhook URL for all agents
- Workflow discovers its persona from `trace.currentOwner`
- All handoffs invoke the same webhook with different traceId

**Benefits:**

- Zero duplication
- One template to maintain
- Add new persona = add config file (no workflow changes)
- Easy to test (one workflow to test)

### ✅ Trace as State Machine

**What it stores:**

- `currentOwner` - Who owns it now
- `workflowStep` - Position in project.workflow array
- `instructions` - What current owner should do
- `projectId` - Which project (defines workflow)
- `status` - active | completed | failed

**State transitions:**

- Agent calls `handoff_to_agent` → trace updated automatically
- Special targets ("complete", "error") → change status, no webhook

### ✅ Projects Define Workflows

**What projects specify:**

- `workflow: ["casey", "iggy", "riley", "veo", "alex", "quinn"]` - Pipeline order
- `optionalSteps: ["alex"]` - Steps that can be skipped
- `specs: { videoCount, duration, ... }` - Project-specific requirements

**Benefits:**

- Flexible pipelines (can add/remove/reorder steps)
- Same agents, different projects
- Easy to add new project types
- Agents discover their role from project workflow

### ✅ Preprocessing + Agent (2 Nodes)

**Preprocessing:**

- Calls MCP tools to gather context
- Assembles system prompt
- Scopes tools to persona.allowedTools

**Agent:**

- Executes work with full context
- Calls memory_store to save outputs
- Calls handoff_to_agent when done (non-blocking)

**No postprocessing needed** - agents own their handoffs!

### ✅ Casey's Completion Signal

Casey's job ends after handoff to Iggy. When Quinn calls `handoff_to_agent({ toAgent: 'complete' })`, the tool automatically:

1. Sets trace status to 'completed'
2. Extracts publish URL from instructions
3. Sends Telegram notification to user directly
4. No polling required - notification is immediate

This is simpler and more efficient than the polling pattern.

**Benefits:**

- Immediate notification (no polling delay)
- Simpler architecture (no wait loop needed)
- User gets notified automatically
- No separate completion signal mechanism needed
- Simple polling pattern

---

## 🔄 Workflow Execution Flow

### Flow Diagram

```
User sends Telegram message
         ↓
┌────────────────────────────────────┐
│ Myloware Agent (Telegram trigger) │
│ No traceId → Create trace          │
│ projectId = 'unknown'              │
│ currentOwner = 'casey'             │
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ Preprocessing: Discover Casey      │
│ Special prompt: "Determine project"│
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ AI Agent (as Casey)                │
│ • trace_update(projectId="aismr")  │
│ • memory_store(kickoff)            │
│ • handoff_to_agent(toAgent="iggy")│
└────────┬───────────────────────────┘
         ↓ (Casey's job complete - notification happens automatically)
┌────────────────────────────────────┐
│ Myloware Agent (Webhook trigger)  │
│ traceId = "trace-001"              │
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ Preprocessing: Discover Iggy       │
│ Load AISMR project + memories      │
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ AI Agent (as Iggy)                 │
│ • memory_search (uniqueness)       │
│ • Generate 12 modifiers            │
│ • memory_store(modifiers)          │
│ • handoff_to_agent(toAgent="riley")│
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ Myloware Agent (Webhook trigger)  │
│ traceId = "trace-001"              │
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ Preprocessing: Discover Riley      │
└────────┬───────────────────────────┘
         ↓
┌────────────────────────────────────┐
│ AI Agent (as Riley)                │
│ • memory_search (get modifiers)    │
│ • Write 12 screenplays             │
│ • memory_store(screenplays)        │
│ • handoff_to_agent(toAgent="veo")  │
└────────┬───────────────────────────┘
         ↓
... continues through Veo → Alex → Quinn ...
         ↓
┌────────────────────────────────────┐
│ AI Agent (as Quinn)                │
│ • Publish to TikTok                │
│ • memory_store(post URL)           │
│ • handoff_to_agent(toAgent="complete")│
└────────┬───────────────────────────┘
         ↓ (Sets trace.status = "completed", sends Telegram notification)
┌────────────────────────────────────┐
│ User receives notification:        │
│ "Video is live! [URL]"              │
└────────────────────────────────────┘
```

**Total time:** 5-8 minutes from message to published video

---

## 💡 How This Improves on V1

### V1 Architecture

- **6 separate workflow files** - Hard to maintain, lots of duplication
- **Hardcoded handoffs** - Personas had fixed next steps
- **No workflow flexibility** - Can't skip steps or change order
- **Manual coordination** - Casey had to manage state
- **Complex webhooks** - Each agent had unique webhook URL

### V2 Architecture

- **1 workflow file** - Zero duplication, single source of truth
- **Dynamic handoffs** - Agents discover next step from project workflow
- **Flexible pipelines** - Projects define workflow, can skip optional steps
- **Automatic coordination** - Trace manages state, agents just query it
- **Simple webhooks** - One webhook URL for all agents

### Migration Path

```
Old:
- workflows/casey.workflow.json
- workflows/iggy.workflow.json
- workflows/riley.workflow.json
- workflows/veo.workflow.json
- workflows/alex.workflow.json
- workflows/quinn.workflow.json

New:
- workflows/myloware-agent.workflow.json  (ONE FILE)
```

### Database Changes

```typescript
// Add to execution_traces table:
currentOwner: text     // Who owns it now
instructions: text     // What they should do
workflowStep: integer  // Position in workflow
previousOwner: text    // History

// Add to projects table:
workflow: text[]       // ["casey", "iggy", "riley", ...]
optionalSteps: text[]  // ["alex"] (can be skipped)

// Remove from personas table:
handoffTarget          // No longer needed
```

---

## 🚀 Implementation Advantages

### For Development

**Simplified Codebase:**

- 1 workflow file instead of 6
- 1 webhook registration instead of 6
- Projects as configuration (add new project = add JSON file)
- Personas as configuration (add new persona = add JSON file)

**Easier Testing:**

- Test one workflow with different traceId values
- Mock trace.currentOwner to test different personas
- Test workflow transitions by updating trace
- Unit test handoff logic separately

**Better Debugging:**

- Query trace to see workflow state
- Query memories by traceId to see agent outputs
- Simple state machine (currentOwner → next agent)
- Clear error states ("error" target)

### For Operations

**Deployment:**

- Deploy one workflow to n8n
- Update persona configs without touching workflow
- Update project workflows without code changes
- Easy rollback (just restore workflow file)

**Monitoring:**

- Poll traces by status to see active workflows
- Count traces by workflowStep to see bottlenecks
- Track handoff patterns via memory search
- Simple health check (trace creation + handoff)

### For Users

**Transparent Experience:**

- Same simple Telegram interface
- HITL at natural checkpoints
- Clear progress updates from Casey
- Fast results (no coordination overhead)

**Flexible Execution:**

- "Simple video" → might skip editing
- "Quick version" → might use fewer modifiers
- "Redo the ending" → can jump back in workflow
- Agents adapt based on request

---

## 📊 Complete Tool Reference

### HTTP Endpoints & MCP Tools

**Preprocessing Endpoint (called by workflow):**

| Endpoint               | Called By         | Purpose                        | Parameters                                         |
| ---------------------- | ----------------- | ------------------------------ | -------------------------------------------------- |
| `POST /mcp/trace_prep` | HTTP Request Node | ONE call for ALL preprocessing | `{ traceId?, source?, sessionId?, instructions? }` |

**Returns:**

```typescript
{
  traceId: string,
  systemPrompt: string,      // Fully assembled prompt
  allowedTools: string[],    // Scoped tools for this persona
  instructions: string,
  memories: Memory[]
}
```

**MCP Tools (called by AI Agent):**

| Tool               | Called By      | Purpose                 | Parameters                                          |
| ------------------ | -------------- | ----------------------- | --------------------------------------------------- |
| `trace_update`     | Casey AI Agent | Update project/metadata | `{ traceId, projectId?, instructions?, metadata? }` |
| `memory_search`    | AI Agent       | Find relevant memories  | `{ query, traceId, project, ... }`                  |
| `memory_store`     | AI Agent       | Save outputs            | `{ content, traceId, persona, project, ... }`       |
| `handoff_to_agent` | AI Agent       | Transfer ownership      | `{ traceId, toAgent, instructions }`                |

### Tool Call Patterns

**Preprocessing (ONE HTTP call):**

```typescript
// Single HTTP POST to /mcp/trace_prep
const prep = await httpRequest('POST', '/mcp/trace_prep', {
  traceId: traceId, // null on first call
  source: 'telegram',
  sessionId: 'telegram:123',
  instructions: 'Make candle videos',
});

// Returns everything assembled:
// - Creates trace if missing
// - Loads persona, project, memories
// - Builds complete system prompt
// - Returns allowed tools
```

**AI Agent Node:**

```typescript
// Agents typically call:
1. memory_search({ traceId, query: "..." })  // Optional: find specific info
2. [Do work]
3. memory_store({ content: "...", traceId })  // Save outputs
4. handoff_to_agent({ traceId, toAgent: "...", instructions: "..." })  // Pass to next
```

**Special Cases:**

```typescript
// Casey with unknown project
await trace_update({ traceId, projectId: 'aismr' });

// Quinn completing workflow
await handoff_to_agent({ traceId, toAgent: 'complete' });

// Any agent encountering fatal error
await handoff_to_agent({
  traceId,
  toAgent: 'error',
  instructions: 'Error details',
});
```

---

## 🎓 Design Philosophy

### 1. Self-Discovery Over Configuration

Agents don't know who they are until runtime:

- Workflow queries trace → discovers it should be "Riley"
- Loads Riley's configuration dynamically
- Becomes Riley for that execution
- Next traceId might make it become "Quinn"

**This is powerful:** Same workflow code, infinite personas.

### 2. Projects Drive Behavior

Same agent, different behavior based on project:

- Iggy on AISMR → generates 12 surreal modifiers
- Iggy on GenReact → generates 6 generational scenarios
- Project configuration tells Iggy what to do

### 3. Trace as Coordination Fabric

No central orchestrator. Just a shared trace:

- Agents update trace when handing off
- Next agent queries trace to discover role
- Memory tagged with traceId provides context
- Workflow is reconstructable from trace + memories

### 4. Minimal Tool Access

Agents only get tools they need:

- Most agents: memory_search, memory_store, handoff_to_agent
- Casey adds: trace_update
- Veo/Alex/Quinn add: External API access

**Principle:** Least privilege. Agents can't call tools they shouldn't.

### 5. Non-Blocking Handoffs

`handoff_to_agent` is async:

- Updates trace in database
- Invokes webhook
- Returns immediately
- Doesn't wait for next agent to complete

**This enables** parallel workflows and prevents blocking.

---

## 🚦 Workflow State Machine

### Trace States

```
active     → Workflow is running
completed  → Quinn handed off to "complete"
failed     → Any agent handed off to "error"
```

### Ownership Transitions

```
Trace created:
  currentOwner = "casey"
  workflowStep = 0

Casey hands off to Iggy:
  currentOwner = "iggy"
  workflowStep = 1
  previousOwner = "casey"

Iggy hands off to Riley:
  currentOwner = "riley"
  workflowStep = 2
  previousOwner = "iggy"

... continues ...

Quinn hands off to "complete":
  currentOwner = "complete"
  status = "completed"
  completedAt = now
```

### Error State Transition

```
Any agent encounters fatal error:

await handoff_to_agent({
  traceId,
  toAgent: "error",
  instructions: "Content policy violation - unable to continue"
});

Trace updated:
  currentOwner = "error"
  status = "failed"
  completedAt = now

handoff_to_agent({ toAgent: "error" }) sets trace.status = "failed"
Error notification sent automatically (if implemented)
```

---

## 🔍 Example Queries

### Find Active Workflows

```sql
SELECT trace_id, current_owner, workflow_step, created_at
FROM execution_traces
WHERE status = 'active'
ORDER BY created_at DESC;
```

### See Workflow Progress

```sql
SELECT
  trace_id,
  project_id,
  current_owner,
  workflow_step,
  status,
  extract(epoch from (now() - created_at)) as seconds_running
FROM execution_traces
WHERE trace_id = 'trace-001';
```

### Reconstruct Workflow History

```sql
-- Get all memories for a trace
SELECT persona, content, created_at
FROM memories
WHERE metadata->>'traceId' = 'trace-001'
ORDER BY created_at ASC;

-- Shows complete workflow history:
-- casey: "User requested AISMR candles"
-- iggy: "Generated 12 modifiers: Void, Liquid..."
-- riley: "Wrote 12 validated screenplays"
-- veo: "Generated 12 videos successfully"
-- alex: "Edited final compilation"
-- quinn: "Published to TikTok"
```

---

## 🎯 Success Metrics

| Metric                      | Target    | How Measured              |
| --------------------------- | --------- | ------------------------- |
| Workflow files to maintain  | 1         | File count                |
| Persona configs to maintain | 6         | File count                |
| Time to add new project     | < 1 hour  | Add JSON + test           |
| Time to add new persona     | < 2 hours | Add config + test         |
| Webhook endpoints           | 1         | Same URL for all          |
| Average workflow completion | < 10 min  | Trace timestamps          |
| Error recovery rate         | > 95%     | Errors handled vs. failed |
| HITL approval rate          | > 90%     | Approvals / total         |

---

## 🚀 Migration from V1

### Phase 1: Database Schema

```sql
-- Add to execution_traces
ALTER TABLE execution_traces
  ADD COLUMN current_owner text NOT NULL DEFAULT 'casey',
  ADD COLUMN instructions text NOT NULL DEFAULT '',
  ADD COLUMN workflow_step integer NOT NULL DEFAULT 0,
  ADD COLUMN previous_owner text;

-- Add to projects
ALTER TABLE projects
  ADD COLUMN workflow text[] NOT NULL DEFAULT '{}',
  ADD COLUMN optional_steps text[] NOT NULL DEFAULT '{}';

-- Remove from personas
ALTER TABLE personas
  DROP COLUMN handoff_target;

-- Drop legacy tables
DROP TABLE IF EXISTS run_events CASCADE;
DROP TABLE IF EXISTS handoff_tasks CASCADE;
DROP TABLE IF EXISTS agent_runs CASCADE;
```

### Phase 2: Workflow Consolidation

```bash
# Archive old workflows
mkdir -p workflows/archive
mv workflows/casey.workflow.json workflows/archive/
mv workflows/iggy.workflow.json workflows/archive/
mv workflows/riley.workflow.json workflows/archive/
mv workflows/veo.workflow.json workflows/archive/
mv workflows/alex.workflow.json workflows/archive/
mv workflows/quinn.workflow.json workflows/archive/

# Create new universal workflow
# (Build in n8n UI, export to workflows/myloware-agent.workflow.json)
```

### Phase 3: Update Configurations

```bash
# Add workflow fields to projects
# data/projects/aismr.json:
{
  ...
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": []
}

# data/projects/genreact.json:
{
  ...
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optionalSteps": ["alex"]
}

# Update personas to remove handoffTarget, add allowedTools
```

### Phase 4: Update MCP Tools

```typescript
// Update handoff_to_agent to handle special targets
if (toAgent === 'complete') {
  await db
    .update(executionTraces)
    .set({
      status: 'completed',
      completedAt: new Date(),
      currentOwner: 'complete',
    })
    .where(eq(executionTraces.traceId, traceId));
  return { success: true, message: 'Trace completed' };
}

if (toAgent === 'error') {
  await db
    .update(executionTraces)
    .set({ status: 'failed', completedAt: new Date(), currentOwner: 'error' })
    .where(eq(executionTraces.traceId, traceId));
  return { success: true, message: 'Trace failed' };
}

// Normal handoff: update trace and invoke webhook
await db
  .update(executionTraces)
  .set({
    currentOwner: toAgent,
    instructions,
    workflowStep: sql`workflow_step + 1`,
    previousOwner: trace.currentOwner,
  })
  .where(eq(executionTraces.traceId, traceId));

await invokeWebhook('myloware-agent', { traceId });
```

---

## 📝 Implementation Checklist

### Epic 1: Trace State Machine

- [ ] Update trace schema (currentOwner, instructions, workflowStep)
- [ ] Implement trace_prepare tool
- [ ] Implement trace_update tool
- [ ] Update handoff_to_agent with special targets ("complete", "error")
- [ ] Remove legacy tables (agent_runs, handoff_tasks, run_events)

### Epic 2: Universal Workflow

- [ ] Create myloware-agent.workflow.json with 3 triggers
- [ ] Implement initialization node (create trace if needed)
- [ ] Implement preprocessing node (discover persona + build prompt)
- [ ] Configure AI Agent node with dynamic prompt and tools
- [x] Completion notification (direct from handoff_to_agent)
- [ ] Archive old workflow files

### Epic 3: Project & Persona Configs

- [ ] Add workflow field to projects
- [ ] Add optionalSteps field to projects
- [ ] Update AISMR project with workflow
- [ ] Create GenReact project with workflow and optionalSteps
- [ ] Update personas with allowedTools
- [ ] Remove handoffTarget from personas
- [ ] Seed all configurations

### Epic 4: Testing

- [ ] Integration test: Casey initialization with unknown project
- [ ] Integration test: Trace ownership transitions
- [ ] Integration test: Workflow discovers persona correctly
- [ ] E2E test: AISMR happy path
- [ ] E2E test: GenReact with optional step skip
- [ ] E2E test: Error handling (handoff to "error")
- [ ] E2E test: Multiple concurrent traces

### Epic 5: Documentation

- [ ] Update ARCHITECTURE.md for single workflow model
- [ ] Update MCP_TOOLS.md with new trace tools
- [ ] Create TRACE_STATE_MACHINE.md
- [ ] Create UNIVERSAL_WORKFLOW.md
- [ ] Update MCP_PROMPT_NOTES.md with new patterns
- [ ] Migration guide for V1 → V2

---

## 🎓 Key Insights

### 1. The Workflow IS the Agent

The Myloware Agent workflow doesn't execute as one persona—it becomes whatever persona the trace says it should be. This is polymorphism at the workflow level.

### 2. Trace = Shared Memory + State

The trace is both:

- **Memory**: What's happened so far (via traceId-tagged memories)
- **State**: Who owns it, what to do next, where in workflow

### 3. Projects Are Pipelines

Projects don't just define specs—they define the entire workflow. Want a different pipeline? Create a new project with a different workflow array.

### 4. Handoff = State Transition

Calling `handoff_to_agent` isn't just triggering a webhook—it's updating the state machine. The webhook invocation is a side effect.

### 5. Direct Completion Notification

Casey's job ends after handoff. Completion notification happens automatically when Quinn calls `handoff_to_agent({ toAgent: 'complete' })`. This is simpler and more efficient than polling.

---

## 💭 Open Questions & Future Considerations

### Concurrent Traces

Can same persona process multiple traces simultaneously?

- **Yes**: Each trace is independent (different traceId)
- Workflow just needs to be stateless
- Trace holds all state

### Dynamic Workflow Modification

Can an agent change the workflow mid-execution?

- Could call `trace_update` to skip steps
- Could set workflowStep to jump backward (retry)
- Could modify instructions for next agent
- **Future enhancement**

### Conditional Branching

What if workflow needs to branch based on content?

- Project could define multiple workflow paths
- Agent could choose path via handoff target
- Example: "complex-edit" vs "simple-edit" workflows
- **Future enhancement**

### Parallel Execution

Can multiple agents work in parallel?

- Currently sequential (one owner at a time)
- Could extend: trace has multiple currentOwners
- Each works on subset of content
- Merge step combines outputs
- **Future enhancement**

---

## 🌈 The Future

### More Projects

```json
{
  "id": "product-review",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "videoCount": 5,
  "format": "camera_angles"
}

{
  "id": "tutorial",
  "workflow": ["casey", "iggy", "riley", "veo", "quinn"],  // Skip Alex
  "videoCount": 8,
  "format": "step_by_step"
}
```

Same workflow. Same agents. Different configurations.

### More Personas

```json
{
  "name": "morgan",
  "role": "Sound Designer",
  "allowedTools": ["memory_search", "memory_store", "handoff_to_agent"]
}
```

Add to some project workflows:

```json
"workflow": ["casey", "iggy", "riley", "veo", "morgan", "alex", "quinn"]
```

No code changes needed!

### Workflow Evolution

Track which workflows succeed:

- AISMR with Alex → 95% approval
- AISMR without Alex → 60% approval
- **Conclusion:** Don't skip Alex for AISMR

Update `optionalSteps` based on data.

---

## 📐 Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────┐
│  Telegram Bot                                       │
│  • User sends messages                              │
│  • Triggers Myloware Agent workflow                 │
│  • Receives status updates from Casey               │
└────────────────┬────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────┐
│  n8n (Workflow Engine)                              │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  myloware-agent.workflow.json                │  │
│  │  • 3 triggers (Telegram, Chat, Webhook)     │  │
│  │  • Initialization node                      │  │
│  │  • Preprocessing node (MCP calls)           │  │
│  │  • AI Agent node (OpenAI)                   │  │
│  │  • Direct completion notification           │  │
│  │                                             │  │
│  │  Becomes any persona dynamically!           │  │
│  └──────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────┘
                 │
                 ↓ MCP Protocol (HTTP)
┌─────────────────────────────────────────────────────┐
│  MCP Server (Tool Interface)                        │
│  • trace_create, trace_prepare, trace_update            │
│  • context_get_persona, context_get_project         │
│  • memory_search, memory_store                      │
│  • handoff_to_agent                                 │
└────────────────┬────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────┐
│  Postgres + pgvector                                │
│  • execution_traces (state machine)                 │
│  • memories (episodic/semantic/procedural)          │
│  • personas (6 agent configs)                       │
│  • projects (workflow definitions)                  │
└─────────────────────────────────────────────────────┘
```

---

## 💡 Why This Is The North Star

### For Users

✅ **Same experience** - Still just text messages and approvals  
✅ **Faster** - No coordination overhead  
✅ **More reliable** - Simpler system = fewer bugs  
✅ **More flexible** - Can skip steps, retry, branch

### For Developers

✅ **One workflow** - Not 6  
✅ **One webhook** - Not 6  
✅ **Configuration over code** - Projects and personas as JSON  
✅ **Easy to test** - Mock trace state  
✅ **Easy to extend** - Add persona/project without touching workflow  
✅ **Self-documenting** - Query trace to see what happened

### For the Business

✅ **Scalable** - Add projects via configuration  
✅ **Maintainable** - One workflow to maintain  
✅ **Debuggable** - Clear state machine  
✅ **Evolvable** - Learn from traces, optimize workflows

---

## 🎯 The Critical Difference from V1

### V1: Six Workflows

```
Casey workflow → calls → Iggy workflow
Iggy workflow → calls → Riley workflow
Riley workflow → calls → Veo workflow
Veo workflow → calls → Alex workflow
Alex workflow → calls → Quinn workflow
Quinn workflow → signals → Casey workflow
```

**Problems:**

- 6 files to maintain
- Hardcoded handoff chains
- Duplicate logic across workflows
- Can't change workflow order

### V2: One Polymorphic Workflow

```
User message → Myloware Agent (becomes Casey)
  ↓ handoff
Webhook → Myloware Agent (becomes Iggy)
  ↓ handoff
Webhook → Myloware Agent (becomes Riley)
  ↓ handoff
Webhook → Myloware Agent (becomes Veo)
  ↓ handoff
Webhook → Myloware Agent (becomes Alex)
  ↓ handoff
Webhook → Myloware Agent (becomes Quinn)
  ↓ handoff to "complete"
handoff_to_agent({ toAgent: 'complete' }) → User notified automatically
```

**Solutions:**

- 1 file to maintain
- Workflow defined by project
- Shared logic, zero duplication
- Easy to reorder, skip, or retry steps

---

## 📝 Implementation Notes

### trace_prep HTTP Endpoint Pseudocode

```typescript
// Server-side: POST /mcp/trace_prep
async function tracePrep(req: {
  traceId?: string;
  source?: string;
  sessionId?: string;
  instructions?: string;
  metadata?: object;
}) {
  // 1. Get or create trace
  let trace;
  if (req.traceId) {
    // Existing trace from handoff
    trace = await db.traces.findById(req.traceId);
  } else {
    // New trace (first time from Telegram/Chat)
    trace = await db.traces.create({
      projectId: 'unknown', // Casey determines this
      sessionId: req.sessionId,
      currentOwner: 'casey',
      instructions: req.instructions,
      workflowStep: 0,
      status: 'active',
      metadata: req.metadata,
    });
  }

  // 2. Load persona
  const persona = await db.personas.findByName(trace.currentOwner);

  // 3. Build prompt based on project status
  let systemPrompt;
  let memories = [];

  if (trace.projectId === 'unknown') {
    // Casey initialization mode
    systemPrompt = `You are Casey, the Showrunner.
    
USER MESSAGE: "${trace.instructions}"

TASK:
1. Determine which project this is for
2. Use trace_update to set the projectId
3. Store a kickoff memory
4. Use handoff_to_agent to pass to the first agent

You have access to: ${persona.allowedTools.join(', ')}`;
  } else {
    // Standard agent mode
    const project = await db.projects.findById(trace.projectId);
    memories = await db.memories.searchByTrace(trace.traceId);

    systemPrompt = `${persona.prompt}

PROJECT: ${project.name}
${project.guardrails}

CURRENT WORKFLOW STEP: ${trace.workflowStep + 1} of ${project.workflow.length} (${trace.currentOwner})
NEXT AGENT: ${project.workflow[trace.workflowStep + 1] || 'complete'}

INSTRUCTIONS: ${trace.instructions}

UPSTREAM WORK:
${memories.map((m) => `- ${m.persona}: ${m.content}`).join('\n')}

When done:
1. Store your outputs via memory_store
2. Call handoff_to_agent to next agent`;
  }

  // 4. Return everything assembled
  return {
    traceId: trace.traceId,
    systemPrompt,
    allowedTools: persona.allowedTools,
    instructions: trace.instructions,
    memories,
  };
}
```

### AI Agent Node Configuration

```yaml
AI Agent Node:
  model: gpt-4-turbo
  systemPrompt: "={{ $('trace_prep').item.json.systemPrompt }}"

  MCP Client:
    url: 'https://mcp-vector.mjames.dev/mcp'
    authHeader: 'X-API-Key'
    apiKey: 'mylo-mcp-bot' # Hard-coded (n8n Cloud doesn't support $env in workflows)
    includeTools: "={{ $('trace_prep').item.json.allowedTools }}" # Dynamic scoping!

# The agent receives:
# - Complete system prompt (persona + project + memories)
# - Only the tools this persona is allowed to use
# - Full context to execute its role
```

### Completion Notification

> **Note:** Completion notification happens automatically when Quinn calls `handoff_to_agent({ toAgent: 'complete' })`. The tool extracts the publish URL from instructions and sends a Telegram notification directly to the user. No polling loop is needed.

**Implementation:**
- Quinn calls `handoff_to_agent({ toAgent: 'complete', instructions: 'Published... URL: https://...' })`
- Tool sets `trace.status = 'completed'`
- Tool extracts URL from instructions (format: "URL: https://...")
- Tool sends Telegram notification: "✅ Your [project] video is live!\n\nWatch: [URL]"
- No webhook invocation (completion is terminal)

---

## 🎊 Success Scenario

```
8:00:00 PM - User: "Make AISMR candles"
8:00:01 PM - Casey: Created trace, determined AISMR project, handed off to Iggy
8:00:02 PM - Iggy: Started generating modifiers...
8:00:45 PM - Iggy: Generated 12 modifiers, sent for user approval
8:01:15 PM - User: Approved! ✓
8:01:16 PM - Iggy: Handed off to Riley
8:01:17 PM - Riley: Started writing screenplays...
8:02:30 PM - Riley: Wrote 12 screenplays, all validated, handed off to Veo
8:02:31 PM - Veo: Started video generation...
8:05:00 PM - Veo: Generated 12 videos, handed off to Alex
8:05:01 PM - Alex: Started editing compilation...
8:06:30 PM - Alex: Finished edit, sent for user review
8:07:00 PM - User: Looks great! ✓
8:07:01 PM - Alex: Handed off to Quinn
8:07:02 PM - Quinn: Started publishing...
8:08:00 PM - Quinn: Published to TikTok, handed off to "complete"
8:08:01 PM - Casey: Detected completion, notifying user...
8:08:02 PM - User: "🎉 Your video is live! https://tiktok.com/..."
```

**Total time:** ~8 minutes from request to published.

---

_"One workflow. One webhook. Infinite possibilities."_

**This is the North Star V2.** ⭐
