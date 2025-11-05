import type {
  WorkflowExecuteParams,
  WorkflowExecuteResult,
} from '../../types/workflow.js';
import { WorkflowRunRepository } from '../../db/repositories/workflow-run-repository.js';
import { workflowExecutions, workflowDuration } from '../../utils/metrics.js';

/**
 * Execute a workflow and track its execution
 *
 * Phase 3: Direct execution mode only (MCP steps executed by agent)
 * Phase 4: Will add n8n delegation mode
 *
 * @param params - Execution parameters
 * @returns Workflow run ID and status
 */
export async function executeWorkflow(
  params: WorkflowExecuteParams
): Promise<WorkflowExecuteResult> {
  const timer = workflowDuration.startTimer({ workflow_name: params.workflowId });
  const repository = new WorkflowRunRepository();

  try {
    // 1. Create workflow run record
    const run = await repository.create({
      sessionId: params.sessionId,
      workflowName: params.workflowId,
      input: params.input,
      metadata: {
        executionMode: 'direct',
        waitForCompletion: params.waitForCompletion || false,
      },
    });

    // 2. Update to running status
    await repository.updateStatus(run.id, 'running');

    // 3. Record metrics
    workflowExecutions.inc({ workflow_name: params.workflowId, status: 'running' });
    timer();

    // 4. For Phase 3: Return immediately with pending status
    // The agent will execute steps itself using available MCP tools
    // In Phase 4, we'll add actual execution logic for n8n delegation
    return {
      workflowRunId: run.id,
      status: 'running',
      output: undefined,
      error: undefined,
    };
  } catch (error) {
    timer();
    workflowExecutions.inc({ workflow_name: params.workflowId, status: 'error' });
    throw error;
  }
}

