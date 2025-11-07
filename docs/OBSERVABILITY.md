# Observability & Diagnostics

Trace-based coordination replaces the legacy `run_state_*` + `handoff_*` stack. Use these queries and MCP tool snippets to inspect production runs anchored by `traceId`.

## SQL Cheat Sheet

### Active Traces
```sql
SELECT trace_id,
       project_id,
       session_id,
       status,
       created_at,
       completed_at,
       metadata
FROM execution_traces
WHERE status = 'active'
ORDER BY created_at DESC;
```

### End-to-End Timeline for a Trace
```sql
SELECT id,
       persona,
       tags,
       content,
       metadata ->> 'traceId' AS trace_id,
       metadata ->> 'toAgent' AS handed_off_to,
       metadata ->> 'executionId' AS n8n_execution,
       created_at
FROM memories
WHERE metadata ->> 'traceId' = '00000000-0000-0000-0000-000000000000'
ORDER BY created_at ASC;
```

### Recently Completed Traces
```sql
SELECT trace_id,
       project_id,
       status,
       completed_at,
       outputs
FROM execution_traces
WHERE status IN ('completed', 'failed')
ORDER BY completed_at DESC
LIMIT 50;
```

### Handoff Audit (memory tags)
```sql
SELECT id,
       content,
       tags,
       metadata ->> 'traceId' AS trace_id,
       created_at
FROM memories
WHERE 'handoff' = ANY(tags)
ORDER BY created_at DESC
LIMIT 25;
```

## MCP Tool Snippets

### Trace Lifecycle
```
// Create trace
trace_create({ projectId: 'aismr', sessionId: 'telegram:6559', metadata: { source: 'casey' } })
  → { traceId, status: 'active', createdAt }

// Delegate work
handoff_to_agent({
  traceId,
  toAgent: 'iggy',
  instructions: 'Generate 12 creative modifiers for candles',
  metadata: { fromAgent: 'casey', step: 'ideation' }
}) → { webhookUrl, executionId, status }

// Close out workflow
workflow_complete({
  traceId,
  status: 'completed',
  outputs: { youtubeUrl: 'https://youtu.be/...', tiktokUrl: 'https://vm.tiktok.com/...' },
  notes: 'Published successfully'
}) → updated execution_traces row
```

### Memory Tagging (per step)
```
memory_store({
  content: 'Iggy delivered 12 modifiers for candles',
  memoryType: 'episodic',
  persona: ['iggy'],
  project: ['aismr'],
  tags: ['handoff', 'iggy'],
  metadata: { traceId, step: 'ideation' }
});

memory_search({
  query: 'final edit',
  project: 'aismr',
  metadata: { traceId }
});
```

### Debugging Tips

- Every n8n webhook invocation stores a memory tagged with `handoff` plus the `traceId`. Filter by `metadata ->> 'executionId'` to correlate downstream failures.
- The `/health` endpoint now lists `trace_create`, `handoff_to_agent`, and `workflow_complete`. If one is missing, restart the MCP server before re-running workflows.
- When a trace is stuck in `active`, search memories for the `traceId` to locate the last successful handoff. Use the recorded `executionId` to inspect n8n logs.
- Prefer SQL + `memory_search` to reconstruct flows—legacy `run_state_*`/`handoff_*` tables are deprecated and no longer populated.
