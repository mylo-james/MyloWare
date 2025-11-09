# Trace State Machine

The `execution_traces` table serves as the state machine that coordinates multi-agent workflows. This document explains how trace ownership, workflow steps, and state transitions work.

---

## Overview

Every production run has a unique `traceId` that connects all agent work. The trace tracks:
- **Who owns it now** (`currentOwner`)
- **Where in the workflow** (`workflowStep`)
- **What to do next** (`instructions`)
- **Completion status** (`status`)

---

## Trace Schema

```sql
CREATE TABLE execution_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID UNIQUE NOT NULL,
  project_id TEXT NOT NULL,
  session_id TEXT,
  current_owner TEXT NOT NULL DEFAULT 'casey',
  previous_owner TEXT,
  instructions TEXT NOT NULL DEFAULT '',
  workflow_step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'failed'
  outputs JSONB,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'
);
```

---

## State Transitions

### Initial State (Trace Creation)

When a user sends a message (Telegram/Chat), `trace_prep` creates a new trace:

```sql
INSERT INTO execution_traces (
  trace_id,
  project_id,
  session_id,
  current_owner,
  workflow_step,
  status
) VALUES (
  'trace-aismr-001',
  'unknown',           -- Casey will determine this
  'telegram:123',
  'casey',            -- Default starting persona
  0,                   -- Start at step 0
  'active'
);
```

**State:**
- `currentOwner = "casey"`
- `workflowStep = 0`
- `projectId = "unknown"`
- `status = "active"`

---

### Normal Handoff (Agent → Agent)

When an agent calls `handoff_to_agent({ traceId, toAgent: "iggy", instructions: "..." })`:

```sql
UPDATE execution_traces
SET
  previous_owner = current_owner,      -- "casey"
  current_owner = 'iggy',               -- New owner
  instructions = 'Generate 12 modifiers...',
  workflow_step = workflow_step + 1    -- 0 → 1
WHERE trace_id = 'trace-aismr-001';
```

**State Transition:**
- `currentOwner`: "casey" → "iggy"
- `previousOwner`: NULL → "casey"
- `workflowStep`: 0 → 1
- `instructions`: Updated with new instructions
- `status`: Remains "active"

**After Update:**
- Webhook invoked: `POST /webhook/myloware/ingest { traceId }`
- Same workflow receives webhook
- `trace_prep` loads trace, finds `currentOwner = "iggy"`
- Workflow becomes Iggy

---

### Completion (Agent → Complete)

When Quinn calls `handoff_to_agent({ traceId, toAgent: "complete", instructions: "..." })`:

```sql
UPDATE execution_traces
SET
  previous_owner = current_owner,      -- "quinn"
  current_owner = 'complete',
  instructions = 'Published successfully...',
  workflow_step = workflow_step + 1,
  status = 'completed',
  completed_at = NOW()
WHERE trace_id = 'trace-aismr-001';
```

**State Transition:**
- `currentOwner`: "quinn" → "complete"
- `status`: "active" → "completed"
- `completedAt`: NULL → NOW()
- **No webhook invoked** (terminal state)

**After Update:**
- Telegram notification sent to user (if sessionId starts with 'telegram:')
- Trace marked as completed
- No further handoffs possible

---

### Error (Agent → Error)

When any agent calls `handoff_to_agent({ traceId, toAgent: "error", instructions: "..." })`:

```sql
UPDATE execution_traces
SET
  previous_owner = current_owner,
  current_owner = 'error',
  instructions = 'Error details...',
  workflow_step = workflow_step + 1,
  status = 'failed',
  completed_at = NOW()
WHERE trace_id = 'trace-aismr-001';
```

**State Transition:**
- `currentOwner`: "{agent}" → "error"
- `status`: "active" → "failed"
- `completedAt`: NULL → NOW()
- **No webhook invoked** (terminal state)

---

## Workflow Step Tracking

The `workflowStep` field tracks position in the project's workflow array:

```json
{
  "name": "aismr",
  "workflow": ["casey", "iggy", "riley", "veo", "alex", "quinn"]
}
```

**Step Mapping:**
- `workflowStep = 0` → Casey (workflow[0])
- `workflowStep = 1` → Iggy (workflow[1])
- `workflowStep = 2` → Riley (workflow[2])
- `workflowStep = 3` → Veo (workflow[3])
- `workflowStep = 4` → Alex (workflow[4])
- `workflowStep = 5` → Quinn (workflow[5])
- `workflowStep = 6` → Complete (beyond workflow array)

**Note:** `workflowStep` increments on every handoff, even for optional steps or backward handoffs (retries).

---

## Ownership History

The `previousOwner` field tracks ownership history:

```
Trace created:
  currentOwner = "casey"
  previousOwner = NULL

Casey → Iggy:
  currentOwner = "iggy"
  previousOwner = "casey"

Iggy → Riley:
  currentOwner = "riley"
  previousOwner = "iggy"

Riley → Veo:
  currentOwner = "veo"
  previousOwner = "riley"

Veo → Alex:
  currentOwner = "alex"
  previousOwner = "veo"

Alex → Quinn:
  currentOwner = "quinn"
  previousOwner = "alex"

Quinn → Complete:
  currentOwner = "complete"
  previousOwner = "quinn"
```

This allows reconstructing the full handoff chain for debugging.

---

## Debugging Queries

### Find Active Traces

```sql
SELECT
  trace_id,
  project_id,
  current_owner,
  workflow_step,
  status,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) as seconds_running
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
  previous_owner,
  workflow_step,
  status,
  instructions,
  created_at,
  completed_at
FROM execution_traces
WHERE trace_id = 'trace-aismr-001';
```

### Reconstruct Handoff Chain

```sql
-- Get all memories for a trace (shows handoff history)
SELECT
  persona,
  content,
  tags,
  created_at
FROM memories
WHERE metadata->>'traceId' = 'trace-aismr-001'
  AND 'handoff' = ANY(tags)
ORDER BY created_at ASC;
```

### Find Stuck Traces

```sql
-- Traces that have been active for > 30 minutes
SELECT
  trace_id,
  current_owner,
  workflow_step,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as minutes_running
FROM execution_traces
WHERE status = 'active'
  AND created_at < NOW() - INTERVAL '30 minutes'
ORDER BY created_at ASC;
```

### Count by Status

```sql
SELECT
  status,
  COUNT(*) as count
FROM execution_traces
GROUP BY status;
```

### Count by Current Owner

```sql
SELECT
  current_owner,
  COUNT(*) as count
FROM execution_traces
WHERE status = 'active'
GROUP BY current_owner
ORDER BY count DESC;
```

---

## Optimistic Locking

To prevent race conditions, `handoff_to_agent` uses optimistic locking:

```typescript
// 1. Read current state
const trace = await traceRepo.findByTraceId(traceId);
const expectedOwner = trace.currentOwner; // "casey"

// 2. Update with check
UPDATE execution_traces
SET current_owner = 'iggy', ...
WHERE trace_id = 'trace-aismr-001'
  AND current_owner = 'casey';  // Optimistic lock check

// 3. If update affects 0 rows, trace was modified by another operation
//    → Retry with exponential backoff (max 3 retries)
```

This ensures only one handoff succeeds if two agents try to hand off simultaneously.

---

## Special States

### Terminal States

- **`status = "completed"`** - Workflow finished successfully
  - Set by: `handoff_to_agent({ toAgent: "complete" })`
  - `currentOwner = "complete"`
  - `completedAt` set
  - No webhook invoked
  - User notification sent (if Telegram session)

- **`status = "failed"`** - Workflow failed
  - Set by: `handoff_to_agent({ toAgent: "error" })`
  - `currentOwner = "error"`
  - `completedAt` set
  - No webhook invoked
  - Error details in `instructions`

### Active State

- **`status = "active"`** - Workflow in progress
  - Default state for new traces
  - Can transition to any agent
  - Can transition to "complete" or "error"

---

## Trace Lifecycle

```
1. CREATE
   User message → trace_prep (no traceId)
   → Creates trace: currentOwner="casey", projectId="unknown", workflowStep=0

2. INITIALIZE
   Casey determines project
   → Updates trace: projectId="550e8400-e29b-41d4-a716-446655440000" // Project UUID

3. HANDOFF LOOP
   Casey → Iggy → Riley → Veo → Alex → Quinn
   Each handoff:
   - Updates currentOwner
   - Increments workflowStep
   - Updates instructions
   - Stores previousOwner
   - Invokes webhook

4. COMPLETE
   Quinn → Complete
   → Updates status="completed"
   → Sets completedAt
   → Sends notification
   → No webhook invoked
```

---

## Best Practices

1. **Always use provided traceId** - Never invent or create new traceIds
2. **Tag memories with traceId** - Store `traceId` in `metadata` for all memories
3. **Check status before handoff** - Verify trace is "active" before handing off
4. **Include clear instructions** - Write natural language instructions for next agent
5. **Handle conflicts gracefully** - Optimistic locking retries handle concurrent handoffs

---

## Related Documentation

- `docs/UNIVERSAL_WORKFLOW.md` - How the universal workflow uses traces
- `docs/ARCHITECTURE.md` - Overall system architecture
- `docs/MCP_TOOLS.md` - Tool reference including `handoff_to_agent`

