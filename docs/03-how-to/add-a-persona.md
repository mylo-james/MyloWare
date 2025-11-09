# How to Add a Persona

**Audience:** Developers adding new agent roles  
**Outcome:** New persona integrated into the pipeline  
**Time:** 30-60 minutes

---

## Overview

Personas are autonomous agents with specific roles in the production pipeline. Adding a new persona requires:
1. Creating persona configuration JSON
2. Registering webhook
3. Testing handoff chain

---

## Prerequisites

- [Local setup complete](../01-getting-started/local-setup.md)
- Understanding of [Universal Workflow](../02-architecture/universal-workflow.md)
- Familiarity with [MCP Tools](../06-reference/mcp-tools.md)

---

## Steps

### 1. Create Persona Configuration

Create `data/personas/your-persona.json`:

```json
{
  "name": "morgan",
  "title": "Sound Designer",
  "systemPrompt": "You are Morgan, the Sound Designer. You enhance videos with audio effects and music. Load video URLs from memory, add audio layers, and hand off enhanced videos to the next agent.",
  "allowedTools": [
    "memory_search",
    "memory_store",
    "job_upsert",
    "jobs_summary",
    "handoff_to_agent"
  ],
  "guardrails": {
    "maxAudioLayers": 3,
    "audioFormat": "aac",
    "sampleRate": 48000
  },
  "metadata": {
    "version": "1.0.0",
    "author": "MyloWare Team"
  }
}
```

**Key fields:**
- `name` - Unique identifier (lowercase, no spaces)
- `title` - Display name
- `systemPrompt` - Core identity (2-3 sentences)
- `allowedTools` - MCP tools this persona can use
- `guardrails` - Behavioral constraints

### 2. Seed Persona to Database

```bash
npm run migrate:personas
```

This reads `data/personas/*.json` and upserts to database.

### 3. Update Project Workflow

Edit `data/projects/your-project.json`:

```json
{
  "slug": "aismr",
  "workflow": [
    "casey",
    "iggy",
    "riley",
    "veo",
    "morgan",  // NEW: Add your persona
    "alex",
    "quinn"
  ],
  "optionalSteps": ["morgan"]  // Optional: Make skippable
}
```

### 4. Seed Project Changes

```bash
npm run migrate:projects
```

### 5. Register Webhook

The universal workflow handles all personas via one webhook. No new webhook needed!

Verify registration:

```bash
psql $DATABASE_URL -c "
  SELECT agent_name, webhook_path, is_active 
  FROM agent_webhooks 
  WHERE agent_name = 'morgan'
"
```

If missing, the universal workflow will still work (all personas use `/webhook/myloware/ingest`).

### 6. Test Handoff Chain

Create integration test in `tests/integration/morgan-handoff.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { traceCreate, handoffToAgent, memorySearch } from '@/mcp/tools';

describe('Morgan handoff', () => {
  it('should receive work from Veo and hand off to Alex', async () => {
    // Create trace
    const trace = await traceCreate({
      projectId: 'aismr-uuid',
      sessionId: 'test:morgan',
    });

    // Simulate Veo handoff to Morgan
    await handoffToAgent({
      traceId: trace.traceId,
      toAgent: 'morgan',
      instructions: 'Add audio to 12 videos. Find URLs in memory.',
    });

    // Verify trace updated
    const updatedTrace = await getTrace(trace.traceId);
    expect(updatedTrace.currentOwner).toBe('morgan');
    expect(updatedTrace.workflowStep).toBe(5); // Morgan's position

    // Verify Morgan can find Veo's work
    const memories = await memorySearch({
      query: 'video URLs',
      traceId: trace.traceId,
      persona: 'veo',
    });
    expect(memories.length).toBeGreaterThan(0);
  });
});
```

Run test:

```bash
npm run test:integration
```

---

## Validation

✅ Persona JSON exists in `data/personas/`  
✅ Persona seeded to database  
✅ Project workflow includes new persona  
✅ Integration test passes  
✅ Handoff chain works (prev → morgan → next)

---

## Best Practices

### System Prompt
- Keep it short (2-3 sentences)
- Focus on core identity and role
- Reference workflow position
- Mention handoff target

### Allowed Tools
- Start with core: `memory_search`, `memory_store`, `handoff_to_agent`
- Add specialized: `job_upsert`, `jobs_summary` (for async work)
- Limit to what's needed (least privilege)

### Guardrails
- Define constraints as structured JSON
- Make them actionable (not vague)
- Include validation criteria

---

## Next Steps

- [Add a Project](add-a-project.md) - Create new production types
- [Run Integration Tests](run-integration-tests.md) - Test coordination
- [Prompt Notes](../06-reference/prompt-notes.md) - Prompt patterns

---

## Troubleshooting

**Persona not found in trace_prep?**
- Verify persona is seeded: `SELECT * FROM personas WHERE name = 'morgan'`
- Check name matches exactly (case-sensitive)

**Tools not available to persona?**
- Check `allowedTools` array in persona JSON
- Verify `trace_prep` returns correct tools

**Handoff skips persona?**
- Check project workflow array includes persona
- Verify workflow order is correct

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

