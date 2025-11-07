import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getWorkflowStatus } from '@/tools/workflow/getStatusTool.js';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { db } from '@/db/client.js';
import { workflowRuns } from '@/db/schema.js';
import { N8nClient } from '@/integrations/n8n/client.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';

describe('getWorkflowStatus', () => {
  beforeEach(async () => {
    vi.spyOn(MemoryRepository.prototype, 'findById').mockImplementation(
      async (memoryId: string) => ({
        id: memoryId,
        content: 'Mock workflow memory',
        summary: 'Mock summary',
        embedding: [],
        memoryType: 'procedural',
        persona: ['casey'],
        project: ['aismr'],
        tags: [],
        relatedTo: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          workflow: { name: `Test Workflow (${memoryId})` },
          n8nWorkflowId: 'n8n-workflow-001',
        },
      } as any)
    );
    vi.spyOn(N8nClient.prototype, 'executeWorkflow').mockResolvedValue('exec-xyz');
    vi.spyOn(N8nClient.prototype, 'waitForCompletion').mockResolvedValue({ status: 'ok' });
    await db.delete(workflowRuns);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return workflow status', async () => {
    // Create a workflow run
    const execution = await executeWorkflow({
      workflowId: 'test-workflow',
      input: { test: 'data' },
    });

    // Query status
    const status = await getWorkflowStatus({
      workflowRunId: execution.workflowRunId,
    });

    expect(status.workflowRunId).toBe(execution.workflowRunId);
    expect(status.status).toBe('running');
    expect(status.workflowName).toBe('Test Workflow (test-workflow)');
    expect(status.input).toEqual({ test: 'data' });
  });

  it('should throw error for unknown workflow run', async () => {
    await expect(
      getWorkflowStatus({ workflowRunId: '00000000-0000-0000-0000-000000000999' })
    ).rejects.toThrow('Workflow run not found');
  });
});
