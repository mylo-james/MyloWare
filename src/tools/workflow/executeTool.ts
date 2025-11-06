import type {
  WorkflowExecuteParams,
  WorkflowExecuteResult,
} from '../../types/workflow.js';
import { WorkflowRunRepository } from '../../db/repositories/workflow-run-repository.js';
import { WorkflowRegistryRepository } from '../../db/repositories/workflow-registry-repository.js';
import { workflowExecutions, workflowDuration } from '../../utils/metrics.js';
import { N8nClient } from '../../integrations/n8n/client.js';
import { config } from '../../config/index.js';
import {
  NotFoundError,
  WorkflowTimeoutError,
  WorkflowExecutionError,
} from '../../utils/errors.js';
import { withTimeout, TimeoutError } from '../../utils/timeout.js';
import { logger } from '../../utils/logger.js';

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
  const registryRepository = new WorkflowRegistryRepository();

  try {
    // 1. Look up n8n workflow ID from registry
    // params.workflowId is a memory UUID, we need to map it to n8n workflow ID
    const registryEntry = await registryRepository.findByMemoryId(params.workflowId);
    
    if (!registryEntry) {
      throw new NotFoundError(
        `No n8n workflow mapped to memory ID: ${params.workflowId}. ` +
        `Ensure the workflow is registered in the workflow_registry table.`
      );
    }

    const n8nWorkflowId = registryEntry.n8nWorkflowId;

    // 2. Create workflow run record
    const run = await repository.create({
      sessionId: params.sessionId,
      workflowName: registryEntry.name, // Use registry name, not memory ID
      input: params.input,
      metadata: {
        executionMode: 'n8n_delegation',
        waitForCompletion: params.waitForCompletion || false,
        memoryId: params.workflowId,
        n8nWorkflowId: n8nWorkflowId,
      },
    });

    // Audit log: workflow execution started
    logger.info({
      msg: 'Workflow execution started',
      workflowRunId: run.id,
      workflowId: params.workflowId,
      n8nWorkflowId,
      sessionId: params.sessionId,
      waitForCompletion: params.waitForCompletion || false,
    });

    // 3. Initialize n8n client
    const n8nClient = new N8nClient({
      baseUrl: config.n8n.baseUrl || 'http://n8n:5678',
      apiKey: config.n8n.apiKey,
    });

    // 4. Trigger n8n workflow with the actual n8n workflow ID
    const executionId = await n8nClient.executeWorkflow(
      n8nWorkflowId,
      params.input
    );

    // 5. Update run with n8n execution ID
    await repository.update(run.id, {
      status: 'running',
      metadata: {
        ...run.metadata,
        n8nExecutionId: executionId,
      },
    });

    // 6. If waitForCompletion, poll for result with timeout
    if (params.waitForCompletion) {
      const timeoutMs = 300000; // 5 minutes default
      try {
        const result = await withTimeout(
          () => n8nClient.waitForCompletion(executionId, timeoutMs),
          {
            timeout: timeoutMs,
            message: `Workflow ${n8nWorkflowId} execution timed out after ${timeoutMs}ms`,
          }
        );
        await repository.updateStatus(run.id, 'completed', {
          output: result as Record<string, unknown>,
        });
        timer();
        workflowExecutions.inc({ workflow_name: params.workflowId, status: 'completed' });
        return {
          workflowRunId: run.id,
          status: 'completed',
          output: result as Record<string, unknown>,
          error: undefined,
        };
      } catch (waitError) {
        const errorMessage =
          waitError instanceof Error ? waitError.message : 'Workflow execution failed';
        
        // Handle timeout specifically
        if (waitError instanceof TimeoutError) {
          logger.error({
            msg: 'Workflow execution timed out',
            workflowId: params.workflowId,
            n8nWorkflowId,
            executionId,
            timeout: timeoutMs,
          });
          
          await repository.updateStatus(run.id, 'failed', {
            error: `Workflow execution timed out after ${timeoutMs}ms`,
          });
          
          timer();
          workflowExecutions.inc({ workflow_name: params.workflowId, status: 'timeout' });
          
          throw new WorkflowTimeoutError(
            `Workflow ${n8nWorkflowId} timed out after ${timeoutMs}ms`,
            params.workflowId,
            executionId,
            timeoutMs
          );
        }
        
        // Handle other errors
        logger.error({
          msg: 'Workflow execution failed',
          workflowId: params.workflowId,
          n8nWorkflowId,
          executionId,
          error: errorMessage,
        });
        
        await repository.updateStatus(run.id, 'failed', {
          error: errorMessage,
        });
        
        timer();
        workflowExecutions.inc({ workflow_name: params.workflowId, status: 'error' });
        
        throw new WorkflowExecutionError(
          `Workflow execution failed: ${errorMessage}`,
          params.workflowId,
          waitError instanceof Error ? waitError : new Error(String(waitError))
        );
      }
    }

    // 7. Return immediately if not waiting
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

