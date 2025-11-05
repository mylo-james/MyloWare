import type {
  WorkflowExecuteParams,
  WorkflowExecuteResult,
} from '../../types/workflow.js';
import { WorkflowRunRepository } from '../../db/repositories/workflow-run-repository.js';
import { workflowExecutions, workflowDuration } from '../../utils/metrics.js';
import { N8nClient } from '../../integrations/n8n/client.js';
import { config } from '../../config/index.js';

/**
 * Execute a workflow and track its execution
 *
 * Delegates workflow execution to n8n API
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
        executionMode: 'n8n_delegation',
        waitForCompletion: params.waitForCompletion || false,
      },
    });

    // 2. Initialize n8n client
    const n8nClient = new N8nClient({
      baseUrl: config.n8n.baseUrl || 'http://n8n:5678',
      apiKey: config.n8n.apiKey,
    });

    // 3. Trigger n8n workflow
    const executionId = await n8nClient.executeWorkflow(
      params.workflowId,
      params.input
    );

    // 4. Update run with n8n execution ID
    await repository.update(run.id, {
      status: 'running',
      metadata: {
        ...run.metadata,
        n8nExecutionId: executionId,
      },
    });

    // 5. If waitForCompletion, poll for result
    if (params.waitForCompletion) {
      try {
        const result = await n8nClient.waitForCompletion(executionId, 300000); // 5 min timeout
        await repository.updateStatus(run.id, 'completed', { output: result as Record<string, unknown> });
        timer();
        workflowExecutions.inc({ workflow_name: params.workflowId, status: 'completed' });
        return {
          workflowRunId: run.id,
          status: 'completed',
          output: result as Record<string, unknown>,
          error: undefined,
        };
      } catch (waitError) {
        await repository.updateStatus(run.id, 'failed', {
          error: waitError instanceof Error ? waitError.message : 'Workflow execution failed',
        });
        timer();
        workflowExecutions.inc({ workflow_name: params.workflowId, status: 'error' });
        throw waitError;
      }
    }

    // 6. Return immediately if not waiting
    timer();
    workflowExecutions.inc({ workflow_name: params.workflowId, status: 'running' });
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

