# n8n Workflow E2E Tests

End-to-end tests for n8n workflows running in the live test environment.

## Quick Start

```bash
# 1. Start test environment
npm run env:test start

# 2. Verify services are running
npm run env:test status

# 3. Run workflow tests
NODE_ENV=test TEST_LIVE_SERVICES=1 npm run test:e2e:live

# 4. Stop test environment
npm run env:test stop
```

## What's Here

### `workflow-test-runner.ts`
Core test harness for invoking and monitoring n8n workflows.

**Features:**
- Invokes workflows via webhooks
- Polls for completion
- Fetches trace data and memories
- Returns structured results

**Example:**
```typescript
const runner = new WorkflowTestRunner(
  'http://localhost:5679',  // n8n test
  'http://localhost:3457'   // MCP test
);

const result = await runner.runWorkflow({
  webhookPath: '/webhook/myloware/ingest',
  input: { message: 'Create AISMR video' },
  timeout: 60000
});

expect(result.success).toBe(true);
```

### `example-workflow.test.ts`
Example test demonstrating the testing pattern.

Shows how to:
- Start a workflow
- Wait for completion
- Assert on trace data
- Check persona participation
- Validate handoffs

### `validators/` (TODO)
Validation utilities for different testing approaches:

- `assertion-validator.ts` - Traditional assertions
- `ai-evaluator.ts` - LLM-as-Judge evaluation
- `snapshot-validator.ts` - Regression detection

## Testing Patterns

### 1. Basic Assertion Test

```typescript
it('should complete workflow', async () => {
  const result = await runner.runWorkflow({
    webhookPath: '/webhook/myloware/ingest',
    input: { message: 'test' },
    timeout: 60000
  });

  expect(result.success).toBe(true);
  expect(result.trace.status).toBe('completed');
});
```

### 2. Persona Participation Test

```typescript
it('should have all personas participate', async () => {
  const result = await runner.runWorkflow({ /* ... */ });

  const personas = ['casey', 'iggy', 'riley', 'veo', 'alex', 'quinn'];
  for (const persona of personas) {
    const memory = result.trace.memories.find(m => 
      m.persona.includes(persona)
    );
    expect(memory).toBeDefined();
  }
});
```

### 3. AI Evaluation Test (TODO)

```typescript
it('should generate quality content', async () => {
  const result = await runner.runWorkflow({ /* ... */ });

  const iggyMemory = result.trace.memories.find(m => 
    m.persona.includes('iggy')
  );
  const modifiers = JSON.parse(iggyMemory.content).modifiers;

  const evaluation = await aiEvaluator.evaluate(
    modifiers,
    [
      { aspect: 'creativity', description: 'Should be creative' },
      { aspect: 'uniqueness', description: 'Should be unique' }
    ],
    'AISMR project context',
    7 // threshold
  );

  expect(evaluation.passed).toBe(true);
  expect(evaluation.score).toBeGreaterThanOrEqual(7);
});
```

## Environment Requirements

### Test Environment Must Be Running

```bash
# Check status
npm run env:test status

# Should show:
# ✅ postgres-test (localhost:5433)
# ✅ mcp-server-test (localhost:3457)
# ✅ n8n-test (localhost:5679)
```

### Environment Variables

Tests read from `.env.test`:

```bash
NODE_ENV=test
N8N_BASE_URL=http://localhost:5679
MCP_SERVER_URL=http://localhost:3457/mcp
MCP_AUTH_KEY=test-mcp-auth-key
DATABASE_URL=postgresql://test:test_password@localhost:5433/mcp_test
```

### Test Flags

- `TEST_LIVE_SERVICES=1` - Enable live workflow tests
- `NODE_ENV=test` - Use test configuration
- `LOG_LEVEL=debug` - Verbose logging (optional)

## Running Tests

### All Workflow Tests

```bash
NODE_ENV=test TEST_LIVE_SERVICES=1 npm run test:e2e:live
```

### Specific Test File

```bash
NODE_ENV=test TEST_LIVE_SERVICES=1 npx vitest tests/e2e/workflows/example-workflow.test.ts
```

### With Verbose Logging

```bash
NODE_ENV=test TEST_LIVE_SERVICES=1 LOG_LEVEL=debug npx vitest tests/e2e/workflows/
```

### Watch Mode

```bash
NODE_ENV=test TEST_LIVE_SERVICES=1 npx vitest tests/e2e/workflows/ --watch
```

## Skipping Live Tests

Tests will automatically skip if `TEST_LIVE_SERVICES` is not set:

```typescript
it.skipIf(!process.env.TEST_LIVE_SERVICES)(
  'should run live test',
  async () => {
    // Test code
  }
);
```

This prevents accidental runs against live services in normal test runs:

```bash
npm test  # Skips live tests (safe)
```

## Test Timeouts

Workflow tests can take time:

```typescript
it('should complete full workflow', async () => {
  // Test code
}, 300000); // 5 minute timeout
```

Default timeout is 60 seconds. Adjust based on workflow complexity:

- **Simple handoff**: 60s
- **Single persona**: 120s (2 min)
- **Full Casey → Quinn**: 300s (5 min)

## Troubleshooting

### Test Environment Not Running

```bash
# Error: Failed to connect to n8n
npm run env:test start
npm run env:test status
```

### Workflow Timeout

```bash
# Increase timeout in test
it('test', async () => { /* ... */ }, 120000); // 2 minutes

# Check workflow logs
npm run env:test logs
```

### Trace Not Found

```bash
# Check MCP server health
curl http://localhost:3457/health

# Check trace exists
curl -H "X-API-Key: test-mcp-auth-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"trace_prepare","arguments":{"traceId":"trace-xxx"}}}' \
  http://localhost:3457/mcp
```

### Port Conflicts

Test environment uses different ports:

- Test: 5433 (postgres), 3457 (mcp), 5679 (n8n)
- Dev: 6543 (postgres), 3456 (mcp), 5678 (n8n)

Make sure dev environment is stopped:

```bash
npm run env:dev stop
```

## Next Steps

1. ✅ **Run example test**: Verify setup works
2. 🏗️ **Build validators**: Implement assertion and AI validators
3. 🧪 **Add persona tests**: Test each persona individually
4. 🚀 **Add full workflow test**: Casey → Quinn end-to-end
5. 📊 **Add to CI**: Automate testing in GitHub Actions

## Documentation

- **Full plan**: [docs/N8N_WORKFLOW_TESTING_PLAN.md](../../../docs/N8N_WORKFLOW_TESTING_PLAN.md)
- **Quick summary**: [N8N_TESTING_SUMMARY.md](../../../N8N_TESTING_SUMMARY.md)
- **Test environment**: [docs/MULTI_ENV_GUIDE.md](../../../docs/MULTI_ENV_GUIDE.md)

## Contributing

When adding new workflow tests:

1. Use `it.skipIf(!process.env.TEST_LIVE_SERVICES)` wrapper
2. Add appropriate timeout for workflow complexity
3. Assert on deterministic aspects first
4. Add AI evaluation for quality checks (when implemented)
5. Log meaningful results for debugging
6. Clean up test data (test env uses tmpfs, auto-cleaned)

Happy testing! 🎯

