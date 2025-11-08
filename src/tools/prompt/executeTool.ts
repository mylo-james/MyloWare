import type {
  PromptExecuteParams,
  PromptExecuteResult,
} from '../../types/prompt.js';
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

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Execute a prompt by delegating to its mapped n8n workflow
 * 
 * Architecture:
 * - Prompts = Semantic/declarative descriptions (procedural memories) that guide WHAT to do
 * - Workflows = Programmatic n8n workflows that execute HOW to do it
 * 
 * This function:
 * 1. Looks up which n8n workflow implements this prompt
 * 2. Delegates execution to that n8n workflow
 * 3. Tracks the execution progress
 *
 * @param params - Execution parameters
 * @returns Prompt run ID and status
 */
export async function executePrompt(
  params: PromptExecuteParams
): Promise<PromptExecuteResult> {
  const timer = workflowDuration.startTimer({ workflow_name: params.promptId });
  const repository = new WorkflowRunRepository();
  const memoryRepository = new MemoryRepository();
  let promptIdentifier = params.promptId;
  let promptName = params.promptName || params.promptId;
  let memoryIdForLogging: string | undefined;
  let n8nWorkflowId = params.n8nWorkflowId?.trim();

  try {
    // 1. Resolve n8n workflow ID either from params or prompt memory metadata
    if (!n8nWorkflowId) {
      const promptMemory = await memoryRepository.findById(params.promptId);
      if (!promptMemory) {
        throw new NotFoundError(
          `Prompt memory not found: ${params.promptId}. ` +
          'Pass n8nWorkflowId directly to executePrompt or store metadata.n8nWorkflowId on the prompt memory.'
        );
      }

      const metadataN8nId = (promptMemory.metadata as Record<string, unknown> | null)?.n8nWorkflowId;
      if (typeof metadataN8nId !== 'string' || !metadataN8nId.trim()) {
        throw new NotFoundError(
          `Prompt memory ${params.promptId} is missing metadata.n8nWorkflowId. ` +
          'Add the n8n workflow ID to the memory metadata or provide it directly to executePrompt.'
        );
      }

      n8nWorkflowId = metadataN8nId.trim();
      const metadataPrompt = promptMemory.metadata?.prompt as { name?: unknown } | undefined;
      promptName =
        params.promptName ||
        (typeof metadataPrompt?.name === 'string'
          ? metadataPrompt.name
          : promptMemory.summary || promptMemory.content || promptName);
      memoryIdForLogging = promptMemory.id;
      promptIdentifier = promptMemory.id;
    }

    if (!n8nWorkflowId) {
      throw new NotFoundError('n8n workflow ID could not be resolved for executePrompt');
    }

    // 2. Create workflow run record
    const run = await repository.create({
      sessionId: params.sessionId,
      workflowName: promptName,
      input: params.input,
      metadata: {
        executionMode: 'n8n_delegation',
        waitForCompletion: params.waitForCompletion || false,
        promptMemoryId: memoryIdForLogging,
        providedPromptId: params.promptId,
        n8nWorkflowId: n8nWorkflowId,
      },
    });

    // Audit log: prompt execution started
    logger.info({
      msg: 'Prompt execution started (delegating to n8n workflow)',
      promptRunId: run.id,
      promptId: promptIdentifier,
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
        ...toRecord(run.metadata),
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
        workflowExecutions.inc({ workflow_name: promptIdentifier, status: 'completed' });
        return {
          success: true,
          promptRunId: run.id,
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
            msg: 'Prompt execution timed out',
            promptId: promptIdentifier,
            n8nWorkflowId,
            executionId,
            timeout: timeoutMs,
          });
          
          await repository.updateStatus(run.id, 'failed', {
            error: `Workflow execution timed out after ${timeoutMs}ms`,
          });
          
          timer();
          workflowExecutions.inc({ workflow_name: promptIdentifier, status: 'timeout' });
          
          throw new WorkflowTimeoutError(
            `Workflow ${n8nWorkflowId} timed out after ${timeoutMs}ms`,
            promptIdentifier,
            executionId,
            timeoutMs
          );
        }
        
        // Handle other errors
        logger.error({
          msg: 'Prompt execution failed',
          promptId: params.promptId,
          n8nWorkflowId,
          executionId,
          error: errorMessage,
        });
        
        await repository.updateStatus(run.id, 'failed', {
          error: errorMessage,
        });
        
        timer();
          workflowExecutions.inc({ workflow_name: promptIdentifier, status: 'error' });
        
        throw new WorkflowExecutionError(
          `Workflow execution failed: ${errorMessage}`,
          promptIdentifier,
          waitError instanceof Error ? waitError : new Error(String(waitError))
        );
      }
    }

    // 7. Return immediately if not waiting
    timer();
    workflowExecutions.inc({ workflow_name: promptIdentifier, status: 'running' });
    return {
      success: true,
      promptRunId: run.id,
      status: 'running',
      output: undefined,
      error: undefined,
    };
  } catch (error) {
    timer();
    workflowExecutions.inc({ workflow_name: promptIdentifier, status: 'error' });
    throw error;
  }
}
