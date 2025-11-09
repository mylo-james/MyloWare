# Run Integration Tests

**Audience:** Developers testing coordination flows  
**Outcome:** Verify agent handoffs work correctly  
**Time:** 5-10 minutes

---

## Overview

Integration tests verify that agents coordinate correctly via traces and memory.

**Test scope:**
- Trace creation and updates
- Agent handoffs
- Memory tagging
- Workflow progression

---

## Prerequisites

- [Local setup complete](../01-getting-started/local-setup.md)
- Docker running (for test database)

---

## Steps

### 1. Run All Integration Tests

```bash
TEST_DB_USE_CONTAINER=1 LOG_LEVEL=warn npm run test:integration
```

This:
- Spins up ephemeral PostgreSQL container
- Runs migrations
- Seeds test data
- Executes integration tests
- Tears down container

### 2. Run Specific Test Suite

```bash
npx vitest run tests/integration/casey-iggy-workflow.test.ts
```

### 3. Watch Mode

```bash
TEST_DB_USE_CONTAINER=1 npx vitest --dir tests/integration
```

---

## Test Categories

### Trace Coordination Tests
**File:** `tests/integration/trace-coordination.test.ts`

Tests:
- Trace creation
- Trace updates
- Status transitions
- Completion signals

### Casey → Iggy Workflow
**File:** `tests/integration/casey-iggy-workflow.test.ts`

Tests:
- Casey creates trace
- Casey hands off to Iggy
- Iggy receives correct context
- Iggy can find Casey's work

### Concurrent Handoffs
**File:** `tests/integration/concurrent-handoffs.test.ts`

Tests:
- Multiple traces run simultaneously
- No cross-contamination
- Each trace maintains independent state

### trace_prep Endpoint
**File:** `tests/integration/trace-prep-endpoint.test.ts`

Tests:
- Trace creation from HTTP request
- Persona discovery
- System prompt assembly
- Tool scoping

---

## Writing Integration Tests

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { traceCreate, handoffToAgent, memorySearch } from '@/mcp/tools';

describe('Agent Handoff', () => {
  let traceId: string;

  beforeEach(async () => {
    // Create test trace
    const trace = await traceCreate({
      projectId: 'test-project-uuid',
      sessionId: 'test:integration',
    });
    traceId = trace.traceId;
  });

  it('should hand off from casey to iggy', async () => {
    // Casey hands off
    await handoffToAgent({
      traceId,
      toAgent: 'iggy',
      instructions: 'Generate 12 modifiers for test',
    });

    // Verify trace updated
    const trace = await getTrace(traceId);
    expect(trace.currentOwner).toBe('iggy');
    expect(trace.workflowStep).toBe(1);

    // Verify Iggy can find Casey's work
    const memories = await memorySearch({
      query: 'casey kickoff',
      traceId,
      persona: 'casey',
    });
    expect(memories.length).toBeGreaterThan(0);
  });
});
```

### Best Practices

1. **Use ephemeral traces** - Create new trace per test
2. **Clean up** - Tests auto-clean via container teardown
3. **Test real flows** - Don't mock MCP tools
4. **Verify memory tagging** - Check `metadata.traceId` exists
5. **Test handoff chain** - Verify each agent can find previous work

---

## Validation

✅ All integration tests pass  
✅ Trace coordination works  
✅ Memory tagging is correct  
✅ Handoffs update trace state  
✅ Agents can find upstream work

---

## Coverage Requirements

Integration tests should cover:
- [ ] Happy path (Casey → Quinn)
- [ ] Error handling (handoff to "error")
- [ ] Completion (handoff to "complete")
- [ ] Concurrent traces
- [ ] Optional step skipping

Current coverage: See `npm run test:coverage`

---

## Next Steps

- [Add a Persona](add-a-persona.md) - Create new agents
- [Add a Project](add-a-project.md) - Define production types
- [Testing Guide](../07-contributing/testing.md) - Test strategy

---

## Troubleshooting

**Tests failing with "database not found"?**
- Ensure Docker is running
- Check `TEST_DB_USE_CONTAINER=1` is set
- Verify Testcontainers can access Docker socket

**Tests timeout?**
- Increase timeout in test file
- Check database connection
- Verify n8n is not required (integration tests don't need n8n)

**Memory not tagged with traceId?**
- Check `memory_store` calls include `metadata: { traceId }`
- Verify persona prompts enforce tagging

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

