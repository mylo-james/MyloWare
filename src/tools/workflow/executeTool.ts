import type {
  WorkflowExecuteParams,
  WorkflowExecuteResult,
} from '../../types/workflow.js';
import { WorkflowRunRepository } from '../../db/repositories/workflow-run-repository.js';
import { MemoryRepository } from '../../db/repositories/memory-repository.js';
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
  const memoryRepository = new MemoryRepository();
  let workflowIdentifier = params.workflowId;
  let workflowName = params.workflowName || params.workflowId;
  let memoryIdForLogging: string | undefined;
  let n8nWorkflowId = params.n8nWorkflowId?.trim();

  try {
    // 1. Resolve n8n workflow ID either from params or memory metadata

    if (!n8nWorkflowId) {
      const workflowMemory = await memoryRepository.findById(params.workflowId);
      if (!workflowMemory) {
        throw new NotFoundError(
          `Workflow memory not found: ${params.workflowId}. ` +
          'Pass n8nWorkflowId directly to executeWorkflow or store metadata.n8nWorkflowId on the workflow memory.'
        );
      }

      const metadataN8nId = (workflowMemory.metadata as Record<string, unknown> | null)?.n8nWorkflowId;
      if (typeof metadataN8nId !== 'string' || !metadataN8nId.trim()) {
        throw new NotFoundError(
          `Workflow memory ${params.workflowId} is missing metadata.n8nWorkflowId.` +
          ' Add the n8n workflow ID to the memory metadata or provide it directly to executeWorkflow.'
        );
      }

      n8nWorkflowId = metadataN8nId.trim();
      const metadataWorkflow = workflowMemory.metadata?.workflow as { name?: unknown } | undefined;
      workflowName =
        params.workflowName ||
        (typeof metadataWorkflow?.name === 'string'
          ? metadataWorkflow.name
          : workflowMemory.summary || workflowMemory.content || workflowName);
      memoryIdForLogging = workflowMemory.id;
      workflowIdentifier = workflowMemory.id;
    }

    if (!n8nWorkflowId) {
      throw new NotFoundError('n8n workflow ID could not be resolved for executeWorkflow');
    }

    // 2. Create workflow run record
    const run = await repository.create({
      sessionId: params.sessionId,
      workflowName,
      input: params.input,
      metadata: {
        executionMode: 'n8n_delegation',
        waitForCompletion: params.waitForCompletion || false,
        memoryId: memoryIdForLogging,
        providedWorkflowId: params.workflowId,
        n8nWorkflowId: n8nWorkflowId,
      },
    });

    // Audit log: workflow execution started
    logger.info({
      msg: 'Workflow execution started',
      workflowRunId: run.id,
      workflowId: workflowIdentifier,
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
        workflowExecutions.inc({ workflow_name: workflowIdentifier, status: 'completed' });
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
          workflowExecutions.inc({ workflow_name: workflowIdentifier, status: 'timeout' });
          
          throw new WorkflowTimeoutError(
            `Workflow ${n8nWorkflowId} timed out after ${timeoutMs}ms`,
            workflowIdentifier,
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
          workflowExecutions.inc({ workflow_name: workflowIdentifier, status: 'error' });
        
        throw new WorkflowExecutionError(
          `Workflow execution failed: ${errorMessage}`,
          workflowIdentifier,
          waitError instanceof Error ? waitError : new Error(String(waitError))
        );
      }
    }

    // 7. Return immediately if not waiting
    timer();
    workflowExecutions.inc({ workflow_name: workflowIdentifier, status: 'running' });
    return {
      workflowRunId: run.id,
      status: 'running',
      output: undefined,
      error: undefined,
    };
  } catch (error) {
    timer();
    workflowExecutions.inc({ workflow_name: workflowIdentifier, status: 'error' });
    throw error;
  }
}
