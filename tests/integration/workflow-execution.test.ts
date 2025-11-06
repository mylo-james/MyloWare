import { describe, it, expect, beforeEach, vi } from 'vitest';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { WorkflowRegistryRepository } from '@/db/repositories/workflow-registry-repository.js';
import { MemoryRepository } from '@/db/repositories/memory-repository.js';
import { NotFoundError } from '@/utils/errors.js';
import { N8nClient } from '@/integrations/n8n/client.js';
import { randomUUID } from 'crypto';

// Mock n8n client
vi.mock('@/integrations/n8n/client.js', () => {
  return {
    N8nClient: vi.fn().mockImplementation(() => ({
      executeWorkflow: vi.fn().mockResolvedValue('n8n-execution-123'),
      waitForCompletion: vi.fn().mockResolvedValue({ result: 'success' }),
    })),
  };
});

describe('Workflow Execution - ID Mapping', () => {
  let registryRepository: WorkflowRegistryRepository;
  let memoryRepository: MemoryRepository;
  let memoryId: string;
  let n8nWorkflowId: string;

  beforeEach(async () => {
    registryRepository = new WorkflowRegistryRepository();
    memoryRepository = new MemoryRepository();

    // Create a test memory
    const memory = await memoryRepository.create({
      content: 'Test workflow for ID mapping',
      embedding: new Array(1536).fill(0.1),
      memoryType: 'procedural',
      metadata: {
        workflow: {
          name: 'Test Workflow',
          description: 'Test',
          steps: [],
        },
      },
    });
    memoryId = memory.id;

    // Register the workflow in the registry
    n8nWorkflowId = 'n8n-test-workflow-123';
    await registryRepository.create({
      memoryId,
      n8nWorkflowId,
      name: 'Test Workflow',
    });
  });

  it('should map memory ID to n8n workflow ID when executing', async () => {
    const execution = await executeWorkflow({
      workflowId: memoryId, // Memory UUID
      input: { test: 'data' },
      sessionId: 'test-session',
    });

    expect(execution.workflowRunId).toBeDefined();
    expect(execution.status).toBe('running');

    // Verify n8n client was called with the correct n8n workflow ID
    const n8nClient = (N8nClient as any).mock.results[0].value;
    expect(n8nClient.executeWorkflow).toHaveBeenCalledWith(
      n8nWorkflowId, // Should be n8n ID, not memory ID
      { test: 'data' }
    );
  });

  it('should throw NotFoundError if memory ID not in registry', async () => {
    const unknownMemoryId = randomUUID();

    await expect(
      executeWorkflow({
        workflowId: unknownMemoryId,
        input: { test: 'data' },
        sessionId: 'test-session',
      })
    ).rejects.toThrow(NotFoundError);

    await expect(
      executeWorkflow({
        workflowId: unknownMemoryId,
        input: { test: 'data' },
        sessionId: 'test-session',
      })
    ).rejects.toThrow(/No n8n workflow mapped to memory ID/);
  });

  it('should only use active workflows from registry', async () => {
    // Deactivate the workflow
    const entry = await registryRepository.findByMemoryId(memoryId);
    if (entry) {
      await registryRepository.deactivate(entry.id);
    }

    // Should fail because workflow is inactive
    await expect(
      executeWorkflow({
        workflowId: memoryId,
        input: { test: 'data' },
        sessionId: 'test-session',
      })
    ).rejects.toThrow(NotFoundError);
  });
});

