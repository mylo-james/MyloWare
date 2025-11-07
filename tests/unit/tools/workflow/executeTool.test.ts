import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { WorkflowRunRepository } from '@/db/repositories/workflow-run-repository.js';
import { WorkflowRegistryRepository } from '@/db/repositories/workflow-registry-repository.js';
import { N8nClient } from '@/integrations/n8n/client.js';
import { db } from '@/db/client.js';
import { workflowRuns } from '@/db/schema.js';

describe('executeWorkflow', () => {
  beforeEach(async () => {
    vi.spyOn(WorkflowRegistryRepository.prototype, 'findByMemoryId').mockImplementation(
      async (memoryId: string) => ({
        id: 'registry-id',
        memoryId,
        n8nWorkflowId: 'n8n-workflow-001',
        name: `Test Workflow (${memoryId})`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );

    vi.spyOn(N8nClient.prototype, 'executeWorkflow').mockResolvedValue('exec-123');
    vi.spyOn(N8nClient.prototype, 'waitForCompletion').mockResolvedValue({ status: 'ok' });

    // Clear workflow runs
    await db.delete(workflowRuns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create workflow run record', async () => {
    const result = await executeWorkflow({
      workflowId: 'test-workflow-123',
      input: { userInput: 'test' },
      sessionId: 'session-abc',
    });

    expect(result.workflowRunId).toBeDefined();
    expect(result.status).toBe('running');

    // Verify record created
    const repository = new WorkflowRunRepository();
    const run = await repository.findById(result.workflowRunId);
    expect(run).toBeDefined();
    expect(run!.workflowName).toBe('Test Workflow (test-workflow-123)');
    expect(run!.status).toBe('running');
  });

  it('should store input data', async () => {
    const input = { userIdea: 'rain', count: 12 };
    const result = await executeWorkflow({
      workflowId: 'test-workflow',
      input,
    });

    const repository = new WorkflowRunRepository();
    const run = await repository.findById(result.workflowRunId);
    expect(run!.input).toEqual(input);
  });

  it('should track session association', async () => {
    const result = await executeWorkflow({
      workflowId: 'test-workflow',
      input: {},
      sessionId: 'session-123',
    });

    const repository = new WorkflowRunRepository();
    const run = await repository.findById(result.workflowRunId);
    expect(run!.sessionId).toBe('session-123');
  });
});
