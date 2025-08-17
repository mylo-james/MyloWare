/**
 * Workflow Orchestrator Service
 *
 * High-level service for orchestrating workflows with proper completion notifications.
 * Demonstrates the use of task completion guardrails.
 */

import { Injectable } from '@nestjs/common';
import {
  createLogger,
  withTaskCompletion,
  notifyTaskSuccess,
  setupCompletionGuardrails,
} from '@myloware/shared';
import { TemporalClientService } from './temporal-client.service';
import type { WorkOrderInput, WorkflowResult } from '../types/workflow';

const logger = createLogger('workflow-service:orchestrator');

@Injectable()
export class WorkflowOrchestratorService {
  constructor(private readonly temporalClient: TemporalClientService) {}

  /**
   * Execute a complete workflow with proper completion notifications
   */
  async executeWorkflow(workOrderInput: WorkOrderInput): Promise<WorkflowResult> {
    const taskName = `Docs Extract & Verify Workflow - ${workOrderInput.workOrderId}`;

    return withTaskCompletion(
      taskName,
      async () => {
        logger.info('Starting workflow execution with completion guardrails', {
          workOrderId: workOrderInput.workOrderId,
          itemCount: workOrderInput.workItems.length,
          priority: workOrderInput.priority,
        });

        // Start the workflow
        const handle = await this.temporalClient.startDocsExtractVerifyWorkflow(workOrderInput);

        logger.info('Workflow started, waiting for completion', {
          workflowId: handle.workflowId,
          workOrderId: workOrderInput.workOrderId,
        });

        // Wait for completion
        const result = await this.temporalClient.waitForWorkflowCompletion(handle.workflowId);

        // Log detailed results
        logger.info('Workflow execution completed', {
          workOrderId: workOrderInput.workOrderId,
          status: result.status,
          completedItems: result.completedItems.length,
          failedItems: result.failedItems.length,
          totalAttempts: result.totalAttempts,
          duration: result.totalDuration,
        });

        return result;
      },
      {
        customSuccessMessage: `🎉 Workflow ${workOrderInput.workOrderId} completed successfully! Processed ${workOrderInput.workItems.length} items.`,
        customFailureMessage: `💔 Workflow ${workOrderInput.workOrderId} failed. Check logs for details.`,
        includeDetails: true,
      }
    );
  }

  /**
   * Batch execute multiple workflows with completion tracking
   */
  async executeBatchWorkflows(workOrders: WorkOrderInput[]): Promise<{
    successful: number;
    failed: number;
    results: WorkflowResult[];
  }> {
    const taskName = `Batch Workflow Execution - ${workOrders.length} workflows`;

    return withTaskCompletion(
      taskName,
      async () => {
        logger.info('Starting batch workflow execution', {
          batchSize: workOrders.length,
          workOrderIds: workOrders.map(wo => wo.workOrderId),
        });

        const results = await Promise.allSettled(
          workOrders.map(workOrder => this.executeWorkflow(workOrder))
        );

        const successful = results.filter(
          r => r.status === 'fulfilled' && r.value.status === 'COMPLETED'
        ).length;
        const failed = results.length - successful;
        const workflowResults = results
          .filter(r => r.status === 'fulfilled')
          .map(r => (r as PromiseFulfilledResult<WorkflowResult>).value);

        logger.info('Batch workflow execution completed', {
          total: workOrders.length,
          successful,
          failed,
        });

        return {
          successful,
          failed,
          results: workflowResults,
        };
      },
      {
        customSuccessMessage: `🚀 Batch execution completed! ${workOrders.length} workflows processed.`,
        customFailureMessage: `⚠️ Batch execution encountered issues. Check individual workflow results.`,
      }
    );
  }

  /**
   * Example of setting up completion guardrails for long-running processes
   */
  async startLongRunningProcess(workOrderId: string): Promise<void> {
    const taskName = `Long Running Process - ${workOrderId}`;

    // Set up guardrails for unexpected termination
    const markCompleted = setupCompletionGuardrails(taskName);

    try {
      logger.info('Starting long-running process with guardrails', { workOrderId });

      // Simulate long-running work
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Mark as completed before sending success notification
      markCompleted();

      // Send success notification
      await notifyTaskSuccess(
        taskName,
        'Long-running process completed successfully',
        `⏱️ ${taskName} finished after extended processing`
      );

      logger.info('Long-running process completed', { workOrderId });
    } catch (error) {
      // The guardrails will handle failure notification if we don't reach markCompleted()
      logger.error('Long-running process failed', {
        workOrderId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
