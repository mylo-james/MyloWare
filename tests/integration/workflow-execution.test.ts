import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import { NotFoundError } from '@/utils/errors.js';
import { N8nClient } from '@/integrations/n8n/client.js';
import { randomUUID } from 'crypto';

describe('Workflow Execution - ID Mapping', () => {
  let memoryRepository: MemoryRepository;
  let memoryId: string;
  let n8nWorkflowId: string;
  let executeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    memoryRepository = new MemoryRepository();

    // Create a test memory
    n8nWorkflowId = 'n8n-test-workflow-123';
    const memory = await memoryRepository.insert({
      content: 'Test workflow for ID mapping',
      embedding: new Array(1536).fill(0.1),
      memoryType: 'procedural',
      metadata: {
        workflow: {
          name: 'Test Workflow',
          description: 'Test',
          steps: [],
        },
        n8nWorkflowId,
      },
    });
    memoryId = memory.id;

    executeSpy = vi.spyOn(N8nClient.prototype, 'executeWorkflow').mockResolvedValue('n8n-execution-123');
    vi.spyOn(N8nClient.prototype, 'waitForCompletion').mockResolvedValue({ result: 'success' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should map memory ID to n8n workflow ID when executing', async () => {
    const execution = await executeWorkflow({
      workflowId: memoryId, // Memory UUID
      input: { test: 'data' },
      sessionId: 'test-session',
    });

    expect(execution.workflowRunId).toBeDefined();
    expect(execution.status).toBe('running');

    expect(executeSpy).toHaveBeenCalledWith(n8nWorkflowId, { test: 'data' });
  });

  it('should throw NotFoundError if workflow memory not found', async () => {
    const unknownMemoryId = randomUUID();

    await expect(
      executeWorkflow({
        workflowId: unknownMemoryId,
        input: { test: 'data' },
        sessionId: 'test-session',
      })
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw when memory metadata lacks n8nWorkflowId', async () => {
    const memory = await memoryRepository.insert({
      content: 'Missing metadata workflow',
      embedding: new Array(1536).fill(0.1),
      memoryType: 'procedural',
      metadata: {
        workflow: {
          name: 'Broken Workflow',
          description: 'Test',
          steps: [],
        },
      },
    });

    await expect(
      executeWorkflow({
        workflowId: memory.id,
        input: { test: 'data' },
        sessionId: 'test-session',
      })
    ).rejects.toThrow(NotFoundError);
  });
});
