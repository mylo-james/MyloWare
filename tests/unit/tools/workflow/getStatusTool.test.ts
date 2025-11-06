import { describe, it, expect, beforeEach } from 'vitest';
import { getWorkflowStatus } from '@/tools/workflow/getStatusTool.js';
import { executeWorkflow } from '@/tools/workflow/executeTool.js';
import { db } from '@/db/client.js';
import { workflowRuns } from '@/db/schema.js';

describe('getWorkflowStatus', () => {
  beforeEach(async () => {
    await db.delete(workflowRuns);
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
    expect(status.workflowName).toBe('test-workflow');
    expect(status.input).toEqual({ test: 'data' });
  });

  it('should throw error for unknown workflow run', async () => {
    await expect(
      getWorkflowStatus({ workflowRunId: 'unknown-run-id' })
    ).rejects.toThrow('Workflow run not found');
  });
});

