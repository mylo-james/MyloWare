# How to Add External Workflow

**Audience:** Developers integrating n8n workflows  
**Outcome:** External workflow callable via `workflow_trigger` tool  
**Time:** 30 minutes

---

## Overview

External workflows are n8n workflows that agents can trigger for specialized tasks (video generation, editing, publishing, etc.).

**Examples:**
- `generate-video` - Video generation via Runway/Veo API
- `edit-aismr` - Shotstack video editing
- `upload-to-tiktok` - TikTok publishing

---

## Prerequisites

- [Local setup complete](../01-getting-started/local-setup.md)
- n8n instance running
- Understanding of [n8n Universal Workflow](../04-integration/n8n-universal-workflow.md)

---

## Steps

### 1. Create n8n Workflow

In n8n UI:

1. Create new workflow
2. Add "Webhook" trigger node
   - Method: POST
   - Path: `/webhook/your-workflow`
3. Add processing nodes
4. Return result

**Example: Video Generation**

```
Webhook Trigger
  ↓
Extract Parameters (Set node)
  ↓
Call Video API (HTTP Request)
  ↓
Poll for Completion (Loop)
  ↓
Return Video URL (Respond to Webhook)
```

### 2. Export Workflow

1. Click "..." menu → Download
2. Save to `workflows/your-workflow.workflow.json`
3. Commit to repo

### 3. Register Workflow Mapping

Create entry in `data/workflows/your-workflow.json`:

```json
{
  "key": "generate-video",
  "name": "Generate Video",
  "description": "Generate video from screenplay using Runway API",
  "n8nWorkflowId": null,
  "webhookPath": "/webhook/generate-video",
  "inputSchema": {
    "screenplay": "object",
    "duration": "number",
    "style": "string"
  },
  "outputSchema": {
    "videoUrl": "string",
    "jobId": "string",
    "duration": "number"
  },
  "metadata": {
    "provider": "runway",
    "timeout": 300000
  }
}
```

### 4. Import to n8n

```bash
npm run import:workflows
```

This imports the workflow and captures the n8n workflow ID.

### 5. Register Mapping

```bash
npm run register:workflows
```

This updates procedural memories with `metadata.n8nWorkflowId`.

### 6. Verify Registration

```bash
psql $DATABASE_URL -c "
  SELECT id, content, metadata->>'n8nWorkflowId' as workflow_id
  FROM memories
  WHERE memory_type = 'procedural'
    AND content LIKE '%generate-video%'
"
```

---

## Using in Personas

### Veo (Production) Example

In `data/personas/veo.json`:

```json
{
  "name": "veo",
  "allowedTools": [
    "memory_search",
    "memory_store",
    "workflow_trigger",
    "job_upsert",
    "jobs_summary",
    "handoff_to_agent"
  ]
}
```

Veo can now call:

```typescript
await workflow_trigger({
  workflowKey: 'generate-video',
  traceId: 'trace-001',
  payload: {
    screenplay: {
      title: 'Void Candle',
      voiceover: 'A candle made of void...',
      duration: 8.0
    }
  }
});
```

---

## Workflow Patterns

### Synchronous (Wait for Result)

```
Webhook Trigger
  ↓
Process
  ↓
Respond to Webhook (with result)
```

Agent waits for response.

### Asynchronous (Job Tracking)

```
Webhook Trigger
  ↓
Start Job (return job ID immediately)
  ↓
Respond to Webhook

[Separate polling]
  ↓
Agent polls via job_upsert/jobs_summary
```

Agent tracks job status separately.

---

## Input/Output Schemas

Define clear schemas for:

**Input:**
```json
{
  "screenplay": {
    "title": "string",
    "voiceover": "string",
    "duration": "number"
  },
  "style": "string",
  "quality": "string"
}
```

**Output:**
```json
{
  "videoUrl": "string",
  "jobId": "string",
  "duration": "number",
  "provider": "string"
}
```

---

## Validation

✅ Workflow exists in n8n  
✅ Workflow exported to `workflows/`  
✅ Mapping registered in database  
✅ Persona can trigger workflow  
✅ Input/output schemas documented

---

## Best Practices

1. **Return quickly** - Don't block for long operations
2. **Use job tracking** - For async work (video generation)
3. **Clear schemas** - Document inputs and outputs
4. **Error handling** - Return errors in consistent format
5. **Idempotency** - Support retries safely

---

## Next Steps

- [n8n Universal Workflow](../04-integration/n8n-universal-workflow.md) - Workflow details
- [Add a Persona](add-a-persona.md) - Create agents that use workflows
- [MCP Tools Reference](../06-reference/mcp-tools.md) - Tool catalog

---

## Troubleshooting

**Workflow not found?**
- Check `n8nWorkflowId` in memory metadata
- Verify workflow is active in n8n
- Run `npm run register:workflows`

**Workflow trigger fails?**
- Check webhook path is correct
- Verify n8n is accessible
- Check input schema matches

**Job tracking not working?**
- Use `job_upsert` to log jobs
- Poll with `jobs_summary` until `pending === 0`
- Check job status in database

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

