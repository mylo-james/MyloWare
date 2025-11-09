/**
 * Example Workflow Test
 * 
 * Demonstrates how to test n8n workflows with assertions and AI evaluation.
 * 
 * Prerequisites:
 *   1. Start test environment: npm run env:test start
 *   2. Verify services: npm run env:test status
 *   3. Run test: NODE_ENV=test TEST_LIVE_SERVICES=1 npx vitest tests/e2e/workflows/example-workflow.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { WorkflowTestRunner } from './workflow-test-runner.js';

describe('Example: n8n Workflow Test', () => {
  let runner: WorkflowTestRunner;

  beforeAll(() => {
    // Check if we should run live tests
    if (!process.env.TEST_LIVE_SERVICES) {
      console.log('⚠️  Skipping live workflow tests (TEST_LIVE_SERVICES not set)');
      return;
    }

    // Initialize runner with test environment URLs
    runner = new WorkflowTestRunner(
      process.env.N8N_BASE_URL || 'http://localhost:5679',  // n8n test
      process.env.MCP_SERVER_URL?.replace('/mcp', '') || 'http://localhost:3457'  // MCP test
    );
  });

  it.skipIf(!process.env.TEST_LIVE_SERVICES)(
    'should complete Casey → Iggy handoff',
    async () => {
      // Step 1: Invoke workflow
      const result = await runner.runWorkflow({
        webhookPath: '/webhook/myloware/ingest',
        input: {
          source: 'test',
          sessionId: 'test-user-001',
          message: 'Generate 12 AISMR candle modifiers',
        },
        timeout: 60000, // 1 minute
      });

      // Step 2: Assert success
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      // Step 3: Assert trace was created
      expect(result.trace.traceId).toBeDefined();
      expect(result.trace.status).toBe('completed');

      // Step 4: Assert Casey participated
      const caseyMemory = result.trace.memories.find(m => 
        m.persona.includes('casey')
      );
      expect(caseyMemory).toBeDefined();

      // Step 5: Assert handoff to Iggy
      expect(result.trace.currentOwner).toBe('iggy');
      expect(result.trace.workflowStep).toBeGreaterThanOrEqual(1);

      // Log results
      console.log('✅ Workflow completed successfully');
      console.log(`   Trace ID: ${result.trace.traceId}`);
      console.log(`   Duration: ${result.duration}ms`);
      console.log(`   Current Owner: ${result.trace.currentOwner}`);
      console.log(`   Workflow Step: ${result.trace.workflowStep}`);
      console.log(`   Memories: ${result.trace.memories.length}`);
    },
    120000 // 2 minute timeout for test
  );

  it.skipIf(!process.env.TEST_LIVE_SERVICES)(
    'should handle invalid input gracefully',
    async () => {
      const result = await runner.runWorkflow({
        webhookPath: '/webhook/myloware/ingest',
        input: {
          source: 'test',
          sessionId: 'test-error-001',
          message: '', // Empty message should trigger error
        },
        timeout: 30000,
      });

      // We expect this to complete, but Casey should handle the empty message
      expect(result.trace.traceId).toBeDefined();
      
      console.log('Handled invalid input:', result.trace.status);
    }
  );
});

// TODO: Add AI evaluation example
// TODO: Add full Casey → Quinn test
// TODO: Add individual persona tests

