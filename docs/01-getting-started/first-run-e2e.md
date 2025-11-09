# First End-to-End Run

**Audience:** Developers who completed local setup  
**Time:** 10 minutes  
**Outcome:** Successfully execute a complete Casey → Quinn production run

---

## Prerequisites

- [Local setup complete](local-setup.md)
- All services running (`npm run dev:docker`)
- Health check passing

---

## Overview

You'll trigger a test run that:
1. Casey creates a trace
2. Iggy generates ideas
3. Riley writes scripts
4. Veo generates videos
5. Alex edits compilation
6. Quinn publishes

---

## Steps

### 1. Seed Test Data

```bash
npm run db:bootstrap -- --seed
```

This creates:
- Test personas (Casey, Iggy, Riley, Veo, Alex, Quinn)
- Test projects (AISMR, GenReact)
- Sample memories

### 2. Import Workflows

```bash
npm run import:workflows
```

Imports the universal workflow to n8n.

### 3. Trigger Test Run

```bash
curl -X POST http://localhost:3456/tools/trace_create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: mylo-mcp-bot" \
  -d '{
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "sessionId": "test:e2e",
    "metadata": {
      "source": "e2e-test",
      "instructions": "Test AISMR candles video"
    }
  }'
```

Save the returned `traceId`.

### 4. Monitor Progress

```bash
# Watch trace status
psql $DATABASE_URL -c "
  SELECT trace_id, current_owner, workflow_step, status 
  FROM execution_traces 
  WHERE trace_id = 'YOUR_TRACE_ID'
"

# Watch memories
psql $DATABASE_URL -c "
  SELECT persona, content, created_at 
  FROM memories 
  WHERE metadata->>'traceId' = 'YOUR_TRACE_ID' 
  ORDER BY created_at DESC 
  LIMIT 10
"
```

### 5. Verify Completion

The trace should progress through:
- `currentOwner: 'casey'` → `'iggy'` → `'riley'` → `'veo'` → `'alex'` → `'quinn'`
- Final `status: 'completed'`

---

## Validation

✅ Trace created with valid UUID  
✅ Trace progresses through all agents  
✅ Each agent stores memories tagged with `traceId`  
✅ Final status is `'completed'`  
✅ Quinn calls `handoff_to_agent({ toAgent: 'complete' })`

---

## Understanding the Flow

### Trace Coordination
Every agent:
1. Loads context via `memory_search({ traceId })`
2. Executes work
3. Stores outputs via `memory_store({ metadata: { traceId } })`
4. Hands off via `handoff_to_agent({ traceId, toAgent, instructions })`

### Universal Workflow
One n8n workflow becomes each persona:
- Receives webhook with `{ traceId }`
- Calls `trace_prep` to discover persona
- Executes as that persona
- Hands off to next agent

See [Trace State Machine](../02-architecture/trace-state-machine.md) for details.

---

## Next Steps

- [Add a Persona](../03-how-to/add-a-persona.md) - Create custom agents
- [Run Integration Tests](../03-how-to/run-integration-tests.md) - Automated testing
- [System Overview](../02-architecture/system-overview.md) - Deep dive

---

## Troubleshooting

**Trace stuck on one agent?**
- Check n8n execution logs
- Verify agent webhook is registered
- Check MCP server logs for errors

**Memories not tagged with traceId?**
- Verify persona prompts include `metadata: { traceId }`
- Check `memory_store` calls in logs

**Handoff not triggering next agent?**
- Verify webhook URL in `agent_webhooks` table
- Check n8n webhook is active
- Verify `handoff_to_agent` tool is called (not just `memory_store`)

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

