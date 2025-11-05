import { describe, it, expect, beforeEach } from 'vitest';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { WorkflowRunRepository } from '@/db/repositories/workflow-run-repository.js';
import { db } from '@/db/client.js';
import { workflowRuns } from '@/db/schema.js';

describe('executeWorkflow', () => {
  beforeEach(async () => {
    // Clear workflow runs
    await db.delete(workflowRuns);
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
    expect(run!.workflowName).toBe('test-workflow-123');
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

