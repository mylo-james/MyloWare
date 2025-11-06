# Observability & Diagnostics

Use these queries and MCP tool calls to inspect the handoff-first orchestration pipeline.

## SQL Cheat Sheet

### Active Runs
```sql
SELECT id AS run_id,
       persona,
       project,
       status,
       current_step,
       custodian_agent,
       locked_at,
       updated_at
FROM agent_runs
WHERE status NOT IN ('completed', 'failed')
ORDER BY updated_at DESC;
```

### Pending Handoffs For A Persona
```sql
SELECT h.id            AS handoff_id,
       h.run_id,
       h.from_persona,
       h.to_persona,
       h.status,
       h.locked_at,
       h.created_at,
       r.persona      AS originating_persona,
       r.current_step AS run_step
FROM handoff_tasks h
JOIN agent_runs r ON r.id = h.run_id
WHERE h.status = 'pending'
  AND h.to_persona = 'editor'
ORDER BY h.created_at ASC;
```

### Run Event Timeline
```sql
SELECT run_id,
       event_type,
       actor,
       payload,
       created_at
FROM run_events
WHERE run_id = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at ASC;
```

## MCP Tool Snippets

### Bootstrap / Inspect Runs
```
run_state_createOrResume({
  sessionId: 'telegram:6559...',
  persona: 'casey',
  project: 'aismr',
  instructions: 'Create an AISMR video'
}) → { runId }

run_state_read({ runId }) → agent_runs row
run_state_update({ runId, patch: { status: 'in_progress', currentStep: 'idea-gen' } })
run_state_appendEvent({ runId, eventType: 'handoff_created', actor: 'casey', payload: { handoffId } })
```

### Handoff Lifecycle
```
handoff_create({ runId, toPersona: 'editor', taskBrief: 'Tidy script' }) → { handoffId }
handoff_claim({ handoffId, agentId: 'agent-editor', ttlMs: 300000 })
handoff_complete({ handoffId, status: 'done', outputs: { url: '...mp4' } })
handoff_listPending({ runId, persona: 'editor' })
```

### Memory Graph (per run)
```
memory_store({
  content: 'Screenplay validated',
  memoryType: 'episodic',
  persona: ['casey'],
  project: ['aismr'],
  tags: ['screenplay'],
  runId,
  relatedTo: ['<previous-memory-id>']
})

memory_searchByRun({ runId, k: 10 }) → chronological episodic trail
```

Use these snippets inside n8n, CLI scripts, or manual MCP calls to debug stalled runs and verify custody. EOF
