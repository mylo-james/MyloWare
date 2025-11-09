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
handoff_to_agent({
  traceId,
  toAgent: 'complete',
  instructions: 'Published successfully. URL: https://vm.tiktok.com/...'
}) → updated execution_traces row (status = completed)
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
- The `/health` endpoint now lists `trace_create` and `handoff_to_agent`. If one is missing, restart the MCP server before re-running workflows.
- When a trace is stuck in `active`, search memories for the `traceId` to locate the last successful handoff. Use the recorded `executionId` to inspect n8n logs.
- Prefer SQL + `memory_search` to reconstruct flows—legacy `run_state_*`/`handoff_*` tables are deprecated and no longer populated.

### n8n Log Capture (Local Development)

File-based logging makes it easier to see how an agent behaved during a run:

1. In `.env.dev` (or the Docker environment), set:
   ```
   N8N_LOG_LEVEL=debug
   N8N_LOG_OUTPUT=console,file
   N8N_LOG_FILE_LOCATION=/home/node/.n8n/logs/n8n.log
   N8N_LOG_FILE_SIZE_MAX=50   # optional, MB
   N8N_LOG_FILE_COUNT_MAX=20  # optional, rotation
   ```
   The `docker-compose.yml` already mounts `/home/node/.n8n`; add a host bind (e.g., `./logs/n8n:/home/node/.n8n/logs`) if you want the files on disk.

2. Start the combined observation loop:
   ```
   npm run dev:obs             # tails the log and streams the latest execution
   npm run dev:obs <execId>    # tail + focus on a specific execution
   ```
   Under the hood, this tails `n8n.log` while running `npm run watch:execution`, so you can watch prompt/tool behaviour without hitting the REST API manually.

3. When investigating a specific run later, use:
   ```
   npm run watch:execution -- <executionId>
   ```
   This pulls the structured execution history from Postgres even after the live tail stops.
