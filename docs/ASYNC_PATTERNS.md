# Async Operations Pattern

Long-running operations (video generation, editing) don't block AI agent nodes. Instead, they use the `toolWorkflow` pattern where async operations are handled internally by separate workflows.

---

## Overview

AI agents call `toolWorkflow` nodes for async operations. The toolWorkflow:
1. Receives input from AI agent
2. Calls the external API and immediately records job state via `job_upsert`
3. Handles async polling internally (via Wait + Switch nodes)
4. Updates job status when complete (or failed) before returning the result
5. AI agent receives result and continues

**Key Benefit:** AI nodes don't timeout on long-running operations.

---

## toolWorkflow Pattern

### In Universal Workflow

The `myloware-agent.workflow.json` includes toolWorkflow nodes:

```json
{
  "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
  "parameters": {
    "description": "Generate individual video clips from screenplays...",
    "workflowId": "ZzHQ2hTTYcdwN63q",
    "workflowInputs": {
      "schema": [
        {
          "id": "traceId",
          "type": "string",
          "required": true
        },
        {
          "id": "screenplay",
          "type": "object",
          "required": true
        }
      ]
    }
  }
}
```

### AI Agent Calls toolWorkflow

When Veo needs to generate a video:

```typescript
// Veo's AI agent calls toolWorkflow
toolWorkflow({
  traceId: "trace-aismr-001",
  screenplay: {
    prompt: "Void Candle - Flame absorbs light",
    duration: 8.0,
    whisperTiming: 3.0
  }
});

// toolWorkflow handles async operations internally
// Returns when complete: { videoUrl: "https://...", taskId: "..." }
```

---

## Video Generation Workflow

### Input

```json
{
  "traceId": "trace-aismr-001",
  "screenplay": {
    "prompt": "Void Candle - Flame absorbs light",
    "duration": 8.0,
    "whisperTiming": 3.0,
    "maxHands": 2
  }
}
```

### Workflow Steps

1. **Call Video API** - Invoke external video generation API
   ```typescript
   const response = await fetch('https://api.runway.com/v1/generate', {
     method: 'POST',
     body: JSON.stringify({ prompt, duration })
   });
   const { taskId } = await response.json();
   ```

2. **Track Job Start (`Track Job Start` node)** - Mark job as `running`
   ```yaml
   HTTP Request:
     url: https://mcp-vector.mjames.dev/mcp
     body:
       tool: job_upsert
       arguments:
         kind: video
         traceId: {{$json.traceId}}
         provider: kie
         taskId: {{$json.data.taskId}}
         status: running
         metadata:
           prompt: {{$json.prompt}}
   ```

3. **Poll Status** - Use Wait/Switch nodes to poll until complete
   ```yaml
   Wait Node:
     type: Wait
     interval: 5000  # Poll every 5 seconds
     condition: response.status === 'completed'
     maxIterations: 60  # 5 minutes max
   ```

4. **Track Job Complete (`Track Job Complete` node)** - Mark job as `succeeded`
   ```yaml
   HTTP Request:
     url: https://mcp-vector.mjames.dev/mcp
     body:
       tool: job_upsert
       arguments:
         kind: video
         traceId: {{$json.traceId}}
         provider: kie
         taskId: {{$json.data.taskId}}
         status: succeeded
         assetUrl: {{$json.data.response.resultUrls[0]}}
         metadata:
           completedAt: {{$now}}
   ```

5. **Return Result** - Return video payload to the agent
   ```json
   {
     "videoUrl": "https://cdn.runway.com/video/123.mp4",
     "taskId": "task-123",
     "status": "completed"
   }
   ```

### Job Tracking

The workflow updates job status at each stage:

```typescript
// After queuing
await job_upsert({ status: 'queued', ... });

// When processing starts
await job_upsert({ status: 'running', ... });

// When complete
await job_upsert({ 
  status: 'succeeded', 
  assetUrl: 'https://...',
  ... 
});
```

This allows Veo to check job status via `jobs_summary`:

```typescript
const summary = await jobs_summary({ 
  traceId: 'trace-aismr-001',
  kind: 'video'
});
// Returns: { pending: 0, succeeded: 12, failed: 0 }
```

---

## Edit Workflow

### Input

```json
{
  "traceId": "trace-aismr-001",
  "videoUrls": [
    "https://cdn.runway.com/video/1.mp4",
    "https://cdn.runway.com/video/2.mp4",
    ...
  ]
}
```

### Workflow Steps

1. **Call Edit API** - Invoke Shotstack API
   ```typescript
   const response = await fetch('https://api.shotstack.io/v1/render', {
     method: 'POST',
     body: JSON.stringify({ timeline: {...}, output: {...} })
   });
   const { response: { id: renderId } } = await response.json();
   ```

2. **Track Job Start (`Track Job Start`)** - Mark job as `running`
   ```yaml
   HTTP Request:
     body:
       tool: job_upsert
       arguments:
         kind: edit
         traceId: {{$json.traceId}}
         provider: shotstack
         taskId: {{$json.response.id}}
         status: running
   ```

3. **Poll Status** - Use Wait/Switch to poll Shotstack
   ```yaml
   Wait Node:
     type: Wait
     interval: 3000  # Poll every 3 seconds
     condition: response.status === 'done'
     maxIterations: 40  # 2 minutes max
   ```

4. **Track Job Complete (`Track Job Complete`)** - Mark job as `succeeded`
   ```yaml
   HTTP Request:
     body:
       tool: job_upsert
       arguments:
         kind: edit
         traceId: {{$json.traceId}}
         provider: shotstack
         taskId: {{$json.response.id}}
         status: succeeded
         assetUrl: {{$json.response.url}}
         metadata:
           completedAt: {{$now}}
   ```

5. **Return Result** - Return final edit URL
   ```json
   {
     "finalUrl": "https://cdn.shotstack.io/render/123.mp4",
     "renderId": "render-123",
     "status": "done"
   }
   ```

---

## Wait Node Configuration

n8n Wait nodes handle async polling:

```json
{
  "type": "n8n-nodes-base.wait",
  "parameters": {
    "amount": 5,
    "unit": "seconds",
    "resume": "webhook",
    "options": {
      "limit": {
        "amount": 60,
        "unit": "minutes"
      }
    }
  }
}
```

**Pattern:**
1. Call external API
2. Get taskId/renderId
3. Wait node pauses workflow
4. Poll API every N seconds
5. Check if status === 'completed'
6. If not complete, continue waiting
7. If complete, return result
8. If timeout, return error

---

## Job Ledger Pattern

Both video generation and editing workflows use the job ledger. The deterministic n8n workflows now manage `job_upsert` calls internally (see the `Track Job Start` and `Track Job Complete` nodes), so AI agents rarely need to call it directly. The data model is unchanged:

### Tables

**`video_generation_jobs`:**
```sql
CREATE TABLE video_generation_jobs (
  id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  provider TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'queued' | 'running' | 'succeeded' | 'failed'
  asset_url TEXT,
  error TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**`edit_jobs`:**
```sql
CREATE TABLE edit_jobs (
  id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  provider TEXT NOT NULL,
  render_id TEXT NOT NULL,
  status TEXT NOT NULL,
  final_url TEXT,
  error TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### MCP Tools

**`job_upsert`** - Still available when deterministic workflows need to record manual failures, but the default tool workflows already call it during start/finish transitions.

**`jobs_summary`** - Get job status summary:
```typescript
const summary = await jobs_summary({
  traceId: 'trace-aismr-001',
  kind: 'video'  // or 'edit'
});
// Returns: { pending: 2, succeeded: 10, failed: 0, total: 12 }
```

---

## Veo Pattern (Video Generation)

### Workflow

```typescript
// 1. Load screenplays from memory
const screenplays = await memory_search({
  traceId: 'trace-aismr-001',
  persona: 'riley',
  tags: ['screenplay', 'validated']
});

// 2. For each screenplay, call toolWorkflow (job ledger updates occur inside the workflow)
for (const screenplay of screenplays) {
  // Call toolWorkflow (blocks until video completes)
  const result = await toolWorkflow({
    traceId: 'trace-aismr-001',
    screenplay: screenplay
  });

  videoUrls.push(result.videoUrl);
}

// 3. Store video URLs
await memory_store({
  content: 'Generated 12 videos for AISMR candles',
  memoryType: 'episodic',
  persona: ['veo'],
  project: ['aismr'],
  metadata: {
    traceId: 'trace-aismr-001',
    videoUrls: videoUrls
  }
});

// 4. Hand off to Alex
await handoff_to_agent({
  traceId: 'trace-aismr-001',
  toAgent: 'alex',
  instructions: 'Edit 12 videos into compilation. Find URLs in memory trace-aismr-001 veo.'
});
```

---

## Alex Pattern (Editing)

### Workflow

```typescript
// 1. Load video URLs from memory
const veoMemories = await memory_search({
  traceId: 'trace-aismr-001',
  persona: 'veo',
  tags: ['video', 'generated']
});

const videoUrls = veoMemories[0].metadata.videoUrls;

// 2. Call toolWorkflow for editing
const result = await toolWorkflow({
  traceId: 'trace-aismr-001',
  videoUrls: videoUrls
});

// 3. Store final edit URL
await memory_store({
  content: 'Created final AISMR compilation. User approved.',
  memoryType: 'episodic',
  persona: ['alex'],
  project: ['aismr'],
  metadata: {
    traceId: 'trace-aismr-001',
    finalEditUrl: result.finalUrl
  }
});
// 4. Hand off to Quinn
await handoff_to_agent({
  traceId: 'trace-aismr-001',
  toAgent: 'quinn',
  instructions: 'Publish final edit to TikTok. Find URL in memory trace-aismr-001 alex.'
});
```

---

## Error Handling

### API Failures

If video generation API fails:

```typescript
try {
  const result = await toolWorkflow({ traceId, screenplay });
} catch (error) {
  // Store error in job ledger
  await job_upsert({
    kind: 'video',
    traceId,
    provider: 'runway',
    taskId: taskId,
    status: 'failed',
    error: error.message
  });
  
  // Hand off to error or retry
  await handoff_to_agent({
    traceId,
    toAgent: 'error',
    instructions: `Video generation failed: ${error.message}`
  });
}
```

### Timeout Handling

If Wait node times out:

```yaml
Wait Node:
  maxIterations: 60  # 5 minutes
  onTimeout: "error"  # Return error if timeout
```

The toolWorkflow returns error, AI agent handles it.

---

## Best Practices

1. **Track jobs immediately** - Call `job_upsert` right after queuing
2. **Verify completion** - Use `jobs_summary` before handoff
3. **Handle errors gracefully** - Store error in job ledger, hand off to "error" if fatal
4. **Use toolWorkflow** - Don't call APIs directly from AI agent (causes timeouts)
5. **Poll internally** - Let toolWorkflow handle polling, not AI agent

---

## Related Documentation

- `docs/TRACE_STATE_MACHINE.md` - How trace coordination works
- `docs/UNIVERSAL_WORKFLOW.md` - Universal workflow pattern
- `docs/MCP_TOOLS.md` - Job ledger tools (`job_upsert`, `jobs_summary`)
- `workflows/myloware-agent.workflow.json` - toolWorkflow node configuration

