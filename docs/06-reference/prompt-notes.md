# Prompt Notes

**Audience:** Prompt engineers, n8n workflow operators  
**Purpose:** Quick reference for agent prompt patterns

For complete vision and narrative, see [NORTH_STAR.md](../../NORTH_STAR.md).  
For persona configuration details, see `data/personas/*.json`.

---

## Global Contract

Every persona inherits this trace-first contract:

```
You are part of a trace-driven AI production pipeline. Follow this contract:

1. Never invent IDs - Only use the provided {traceId, projectId, sessionId}
2. Tool call sequence:
   a. memory_search (with traceId filter) to load context
   b. [Execute your work]
   c. memory_store (single line, include traceId in metadata)
   d. handoff_to_agent (clear natural language instructions)
3. Memory tagging - Every memory MUST include:
   - metadata.traceId: the trace you're working on
   - persona: your persona name in array format
   - project: the project name in array format
4. Handoff discipline:
   - Use handoff_to_agent tool (don't just store a memory)
   - Include clear instructions for next agent
   - Tell them where to find your work (memory search by traceId)
5. Error handling:
   - For blocking errors: handoff_to_agent({ toAgent: 'error', instructions: 'details' })
   - For completion: handoff_to_agent({ toAgent: 'complete', instructions: 'summary' })
```

---

## Universal Workflow Pattern

One n8n workflow (`myloware-agent.workflow.json`) becomes any persona:

1. **Trigger** (Telegram/Chat/Webhook) → Edit Fields
2. **trace_prep HTTP Request** → `POST /mcp/trace_prep { traceId?, sessionId?, instructions? }`
3. **AI Agent Node** → Receives `systemPrompt` + `allowedTools` from trace_prep
4. **Agent executes** → Calls MCP tools (memory_search, memory_store, handoff_to_agent)
5. **Handoff** → Invokes same workflow via webhook with `{ traceId }`

The `trace_prep` endpoint:
- Creates trace if missing (defaults to Casey + "unknown" project)
- Loads trace if provided
- Discovers persona from `trace.currentOwner`
- Loads project config + memories
- Builds complete system prompt
- Returns `allowedTools` scoped to persona

---

## Tool Quick Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `trace_update` | Update trace metadata | `traceId`, `projectId?`, `instructions?` |
| `memory_search` | Find memories | `query`, `traceId` (required), `project`, `limit` |
| `memory_store` | Save outputs | `content`, `memoryType`, `persona[]`, `project[]`, `traceId` |
| `handoff_to_agent` | Transfer ownership | `traceId`, `toAgent`, `instructions` |
| `job_upsert` | Track async jobs | `traceId`, `kind`, `provider`, `taskId`, `status` |
| `jobs_summary` | Check job status | `traceId` |

**Special handoff targets:**
- `toAgent: 'complete'` - Marks trace completed, sends notification
- `toAgent: 'error'` - Marks trace failed, logs error

---

## Persona Summaries

### Casey (Showrunner)
**Role:** Start production runs, determine project, hand off to Iggy  
**Tools:** `trace_update`, `memory_search`, `memory_store`, `handoff_to_agent`  
**Key behavior:** Determines project from user message, creates trace, briefs Iggy  
**Config:** `data/personas/casey.json`

### Iggy (Creative Director)
**Role:** Generate ideas, validate uniqueness, seek approval  
**Tools:** `memory_search`, `memory_store`, `handoff_to_agent`  
**Key behavior:** Generates 12 AISMR modifiers or 6 GenReact scenarios, checks archive for duplicates  
**Config:** `data/personas/iggy.json` (formerly `ideagenerator.json`)

### Riley (Head Writer)
**Role:** Write validated screenplays from ideas  
**Tools:** `memory_search`, `memory_store`, `handoff_to_agent`  
**Key behavior:** Loads Iggy's ideas, writes 8s scripts, validates timing/specs  
**Config:** `data/personas/riley.json` (formerly `screenwriter.json`)

### Veo (Production)
**Role:** Generate videos from screenplays  
**Tools:** `memory_search`, `memory_store`, `job_upsert`, `jobs_summary`, `handoff_to_agent`  
**Key behavior:** Loads Riley's scripts, calls video APIs, tracks jobs, stores URLs  
**Config:** `data/personas/veo.json`

### Alex (Editor)
**Role:** Stitch compilation, seek approval  
**Tools:** `memory_search`, `memory_store`, `job_upsert`, `jobs_summary`, `handoff_to_agent`  
**Key behavior:** Loads Veo's videos, calls editing API, waits for HITL approval  
**Config:** `data/personas/alex.json`

### Quinn (Publisher)
**Role:** Publish to platforms, signal completion  
**Tools:** `memory_search`, `memory_store`, `handoff_to_agent`  
**Key behavior:** Loads Alex's final edit, publishes to TikTok/YouTube, calls `handoff_to_agent({ toAgent: 'complete' })`  
**Config:** `data/personas/quinn.json`

---

## Memory Tagging Pattern

Every memory created during a trace must include:

```typescript
{
  "content": "Single-line summary (no newlines)",
  "memoryType": "episodic",
  "persona": ["iggy"],
  "project": ["aismr"],
  "tags": ["ideas", "approved"],
  "metadata": {
    "traceId": "trace-001",  // REQUIRED
    // ... other fields
  }
}
```

This enables:
- Agents to find upstream work via `memory_search({ traceId })`
- Full execution graph reconstruction
- Trace-scoped debugging

---

## Handoff Pattern

Every handoff must include:

```typescript
{
  "traceId": "trace-001",
  "toAgent": "riley",
  "instructions": "Write 12 screenplays for the modifiers I generated. Each should be 8.0s, AISMR format. Find modifiers in memory tagged with trace-001 and persona iggy."
}
```

**Good instructions:**
- Natural language (2-4 sentences)
- What to do
- Where to find inputs (memory search criteria)
- What format/specs to follow

**Bad instructions:**
- "Do your job" (too vague)
- Missing traceId reference
- No guidance on finding inputs

---

## HITL (Human-in-the-Loop)

Approvals happen via **n8n Telegram "Send and Wait" nodes**, not MCP tools.

**Pattern:**
1. Agent stores outputs to memory
2. n8n Telegram node sends preview + approval buttons
3. User approves/rejects
4. Workflow branches:
   - Approved → Agent calls `handoff_to_agent`
   - Rejected → Agent regenerates with feedback

**Agents with HITL:**
- Iggy (after generating ideas)
- Alex (after editing compilation)

---

## Project Configuration

Projects define workflow order and specs:

```json
{
  "slug": "aismr",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"],
  "optional_steps": [],
  "specs": {
    "videoCount": 12,
    "videoDuration": 8.0,
    "whisperTiming": 3.0,
    "maxHands": 2
  }
}
```

See `data/projects/*.json` for complete configurations.

---

## Debugging Tips

### Trace stuck on one agent?
```sql
-- Check trace status
SELECT trace_id, current_owner, workflow_step, status 
FROM execution_traces 
WHERE trace_id = 'trace-001';

-- Check last memory
SELECT persona, content, created_at 
FROM memories 
WHERE metadata->>'traceId' = 'trace-001' 
ORDER BY created_at DESC 
LIMIT 1;
```

### Agent not finding upstream work?
- Verify memories include `metadata.traceId`
- Check `memory_search` includes `traceId` filter
- Verify persona/project arrays match

### Handoff not triggering?
- Verify `handoff_to_agent` tool is called (not just `memory_store`)
- Check webhook URL in `agent_webhooks` table
- Verify n8n workflow is active

---

## Further Reading

- [NORTH_STAR.md](../../NORTH_STAR.md) - Complete vision and detailed walkthrough
- [Trace State Machine](../02-architecture/trace-state-machine.md) - Coordination details
- [Universal Workflow](../02-architecture/universal-workflow.md) - Workflow pattern
- [MCP Tools Reference](mcp-tools.md) - Complete tool catalog
- Persona configs: `data/personas/*.json`
- Project configs: `data/projects/*.json`
