import { describe, it, expect } from 'vitest';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import { vi } from 'vitest';

// Mock n8n client
vi.mock('@/integrations/n8n/client.js', () => {
  return {
    N8nClient: vi.fn().mockImplementation(() => ({
      executeWorkflow: vi.fn().mockResolvedValue('n8n-execution-123'),
      waitForCompletion: vi.fn().mockResolvedValue({ result: 'success' }),
    })),
  };
});

describe('Concurrent Workflow Execution Performance', () => {
  it('should handle 10 concurrent workflow executions', async () => {
    const memoryRepository = new MemoryRepository();

    // Create test workflows
    const workflows = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const n8nId = `n8n-workflow-${i}`;
        const memory = await memoryRepository.insert({
          content: `Test workflow ${i}`,
          embedding: new Array(1536).fill(0.1),
          memoryType: 'procedural',
          metadata: {
            workflow: {
              name: `Workflow ${i}`,
              description: 'Test',
              steps: [],
            },
            n8nWorkflowId: n8nId,
          },
        });

        return memory.id;
      })
    );

    // Execute all workflows concurrently
    const start = Date.now();
    const executions = await Promise.all(
      workflows.map((workflowId) =>
        executeWorkflow({
          workflowId,
          input: { test: 'data' },
          sessionId: `test-session-${workflowId}`,
        })
      )
    );
    const duration = Date.now() - start;

    // All should complete successfully
    expect(executions.length).toBe(10);
    executions.forEach((execution) => {
      expect(execution.workflowRunId).toBeDefined();
      expect(execution.status).toBe('running');
    });

    // Should complete in reasonable time (< 2 seconds for 10 concurrent)
    expect(duration).toBeLessThan(2000);
  });

  it('should handle workflow execution with waitForCompletion', async () => {
    const memoryRepository = new MemoryRepository();

    const memory = await memoryRepository.insert({
      content: 'Test workflow with completion',
      embedding: new Array(1536).fill(0.1),
      memoryType: 'procedural',
      metadata: {
        workflow: {
          name: 'Test Workflow',
          description: 'Test',
          steps: [],
        },
        n8nWorkflowId: 'n8n-test-123',
      },
    });

    const start = Date.now();
    const execution = await executeWorkflow({
      workflowId: memory.id,
      input: { test: 'data' },
      sessionId: 'test-session',
      waitForCompletion: true,
    });
    const duration = Date.now() - start;

    expect(execution.status).toBe('completed');
    expect(execution.output).toBeDefined();
    // With mocked n8n, should complete quickly
    expect(duration).toBeLessThan(1000);
  });
});
