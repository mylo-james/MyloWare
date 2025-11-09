# System Overview

**Audience:** Developers and architects  
**Outcome:** Understand MyloWare's high-level architecture

---

## Core Principles

1. **Trace-Driven** - Every production run has a unique `traceId` for coordination
2. **Self-Discovering** - One workflow becomes any persona dynamically
3. **Memory-First** - Agents coordinate via tagged memories, not central state

---

## The Stack

```
┌─────────────────────────────────────────────────┐
│                   USER                          │
│              (Telegram / API)                   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              n8n WORKFLOWS                      │
│  • Universal workflow (myloware-agent)          │
│  • Becomes any persona dynamically              │
│  • MCP tool calling                             │
│  • HITL via Telegram nodes                      │
└────────────────────┬────────────────────────────┘
                     │
                     ▼ HTTP (MCP Protocol)
┌─────────────────────────────────────────────────┐
│              MCP SERVER                         │
│  • 10+ MCP tools (memory, trace, handoff)       │
│  • Zod validation                               │
│  • Prometheus metrics                           │
│  • Health checks                                │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│         POSTGRES (with pgvector)                │
│  • Vector search (embeddings)                   │
│  • Trace coordination (execution_traces)        │
│  • Memory storage (memories)                    │
│  • Configuration (personas, projects)           │
└─────────────────────────────────────────────────┘
```

---

## Key Components

### Universal Workflow
One n8n workflow (`myloware-agent.workflow.json`) handles all personas:
- Receives trigger (Telegram/Chat/Webhook)
- Calls `trace_prep` to discover persona from trace
- Executes as that persona with scoped tools
- Hands off to next agent via webhook

See [Universal Workflow](universal-workflow.md) for details.

### Trace State Machine
The `execution_traces` table coordinates agent handoffs:
- `traceId` - Unique production run identifier
- `currentOwner` - Which persona owns the trace (casey, iggy, riley, etc.)
- `workflowStep` - Position in project workflow
- `status` - active | completed | failed

See [Trace State Machine](trace-state-machine.md) for details.

### MCP Tools
10+ tools for memory, coordination, and execution:
- `memory_search` / `memory_store` - Context and outputs
- `trace_create` / `handoff_to_agent` - Coordination
- `context_get_persona` / `context_get_project` - Configuration
- `job_upsert` / `jobs_summary` - Async job tracking

See [MCP Tools Reference](../06-reference/mcp-tools.md) for complete catalog.

### Database
PostgreSQL with pgvector extension:
- **Vector search** - Semantic memory retrieval (HNSW index)
- **Trace coordination** - State machine for agent handoffs
- **Configuration** - Personas, projects, workflows
- **Job tracking** - Video generation and editing jobs

See [Data Model](data-model.md) for schema details.

---

## Agent Pipeline

```
User Message
     ↓
Casey (Showrunner)
  • Creates trace
  • Determines project
  • Hands off to Iggy
     ↓
Iggy (Creative Director)
  • Generates ideas
  • HITL approval
  • Hands off to Riley
     ↓
Riley (Head Writer)
  • Writes scripts
  • Validates specs
  • Hands off to Veo
     ↓
Veo (Production)
  • Generates videos
  • Tracks jobs
  • Hands off to Alex
     ↓
Alex (Editor)
  • Stitches compilation
  • HITL approval
  • Hands off to Quinn
     ↓
Quinn (Publisher)
  • Publishes to platforms
  • Stores URLs
  • Signals completion
     ↓
User Notification
```

---

## Coordination Pattern

Every agent follows the same pattern:

1. **Load Context**
   ```typescript
   const memories = await memory_search({ 
     traceId, 
     persona: 'previous-agent' 
   });
   ```

2. **Execute Work**
   - Generate ideas, write scripts, create videos, etc.
   - Follow project specs and guardrails

3. **Store Outputs**
   ```typescript
   await memory_store({
     content: 'Generated 12 modifiers...',
     memoryType: 'episodic',
     persona: ['iggy'],
     project: ['aismr'],
     metadata: { traceId }
   });
   ```

4. **Hand Off**
   ```typescript
   await handoff_to_agent({
     traceId,
     toAgent: 'riley',
     instructions: 'Write scripts for the 12 modifiers...'
   });
   ```

---

## Special Handoff Targets

- `handoff_to_agent({ toAgent: 'complete' })` - Marks trace completed, sends notification
- `handoff_to_agent({ toAgent: 'error' })` - Marks trace failed, logs error

---

## Data Flow Example

```
1. User: "Make AISMR candles video"
   → Telegram trigger → Universal workflow

2. trace_prep creates trace
   → traceId: "trace-001"
   → currentOwner: "casey"
   → projectId: "unknown"

3. Casey determines project = "aismr"
   → trace_update({ projectId: "550e8400..." })
   → handoff_to_agent({ toAgent: "iggy" })

4. Webhook invokes universal workflow
   → trace_prep loads trace
   → currentOwner = "iggy"
   → Workflow becomes Iggy

5. Iggy generates 12 modifiers
   → memory_store({ metadata: { traceId } })
   → handoff_to_agent({ toAgent: "riley" })

6. Process repeats through all agents
   → Riley → Veo → Alex → Quinn

7. Quinn publishes and signals completion
   → handoff_to_agent({ toAgent: "complete" })
   → User receives notification
```

---

## Key Design Decisions

### Why One Workflow?
- **Zero duplication** - One file to maintain, not six
- **Dynamic personas** - Workflow discovers role from trace
- **Easy testing** - Mock trace state to test any persona
- **Simple handoffs** - Same webhook URL for all agents

### Why Trace-Driven?
- **Decentralized** - No central orchestrator needed
- **Observable** - Full execution graph in memories
- **Resumable** - Can restart from any step
- **Scalable** - Multiple traces run concurrently

### Why Memory-First?
- **Semantic discovery** - Find context by meaning
- **Flexible** - No rigid schemas for agent outputs
- **Evolvable** - Add fields without migrations
- **Searchable** - Vector + keyword hybrid search

---

## Performance Characteristics

- **Memory search:** < 100ms (p95) with HNSW index
- **Trace coordination:** < 50ms (simple DB updates)
- **Agent handoff:** < 200ms (webhook invocation)
- **End-to-end:** 5-8 minutes (AISMR video, 12 clips)

---

## Next Steps

- [Universal Workflow](universal-workflow.md) - Deep dive on workflow pattern
- [Trace State Machine](trace-state-machine.md) - Coordination details
- [Data Model](data-model.md) - Database schema
- [NORTH_STAR.md](../../NORTH_STAR.md) - Complete vision and walkthrough

---

## Further Reading

- [MCP Integration](../04-integration/mcp-integration.md) - Connect clients
- [Observability](../05-operations/observability.md) - Monitor production
- [Development Guide](../07-contributing/dev-guide.md) - Start contributing

