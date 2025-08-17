/**
 * Temporal Client Service
 *
 * Manages Temporal client operations for workflow execution and monitoring.
 * This service handles workflow lifecycle, queries, and signals.
 */

import { Client, Connection, WorkflowHandle } from '@temporalio/client';
import { createLogger } from '@myloware/shared';
import {
  DEFAULT_WORKFLOW_CONFIG,
  TEMPORAL_WORKFLOW_OPTIONS,
  WorkOrderInput,
  WorkflowResult,
} from '../types/workflow';
import {
  docsExtractVerifyWorkflow,
  getStatusQuery,
  getProgressQuery,
  pauseSignal,
  resumeSignal,
  cancelSignal,
} from '../workflows/docs-extract-verify.workflow';

const logger = createLogger('workflow-service:temporal-client');

export class TemporalClientService {
  private client: Client | null = null;
  private connection: Connection | null = null;

  constructor(
    private readonly temporalHost: string = 'localhost',
    private readonly temporalPort: number = 7233,
    private readonly namespace: string = DEFAULT_WORKFLOW_CONFIG.namespace
  ) {}

  /**
   * Initialize the Temporal client
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Temporal client', {
        host: this.temporalHost,
        port: this.temporalPort,
        namespace: this.namespace,
      });

      // Create connection to Temporal server
      this.connection = await Connection.connect({
        address: `${this.temporalHost}:${this.temporalPort}`,
      });

      // Create client
      this.client = new Client({
        connection: this.connection,
        namespace: this.namespace,
      });

      logger.info('Temporal client initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to initialize Temporal client', { error: errorMessage });
      throw new Error(`Temporal client initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Start a new Docs Extract & Verify workflow
   */
  async startDocsExtractVerifyWorkflow(
    workOrderInput: WorkOrderInput,
    workflowId?: string
  ): Promise<WorkflowHandle<typeof docsExtractVerifyWorkflow>> {
    if (!this.client) {
      throw new Error('Temporal client not initialized');
    }

    try {
      const finalWorkflowId = workflowId || `docs-extract-verify-${workOrderInput.workOrderId}`;

      logger.info('Starting Docs Extract & Verify workflow', {
        workOrderId: workOrderInput.workOrderId,
        workflowId: finalWorkflowId,
        itemCount: workOrderInput.workItems.length,
        priority: workOrderInput.priority,
      });

      const handle = await this.client.workflow.start(docsExtractVerifyWorkflow, {
        args: [workOrderInput],
        workflowId: finalWorkflowId,
        ...TEMPORAL_WORKFLOW_OPTIONS,
      });

      logger.info('Workflow started successfully', {
        workOrderId: workOrderInput.workOrderId,
        workflowId: handle.workflowId,
        runId: handle.firstExecutionRunId,
      });

      return handle;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to start workflow', {
        workOrderId: workOrderInput.workOrderId,
        error: errorMessage,
      });
      throw new Error(`Workflow start failed: ${errorMessage}`);
    }
  }

  /**
   * Get workflow handle by ID
   */
  async getWorkflowHandle(
    workflowId: string
  ): Promise<WorkflowHandle<typeof docsExtractVerifyWorkflow>> {
    if (!this.client) {
      throw new Error('Temporal client not initialized');
    }

    return this.client.workflow.getHandle(workflowId);
  }

  /**
   * Query workflow status
   */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowResult> {
    const handle = await this.getWorkflowHandle(workflowId);
    return await handle.query(getStatusQuery);
  }

  /**
   * Query workflow progress
   */
  async getWorkflowProgress(
    workflowId: string
  ): Promise<{ completed: number; total: number; current?: string }> {
    const handle = await this.getWorkflowHandle(workflowId);
    return await handle.query(getProgressQuery);
  }

  /**
   * Pause a workflow
   */
  async pauseWorkflow(workflowId: string): Promise<void> {
    const handle = await this.getWorkflowHandle(workflowId);
    await handle.signal(pauseSignal);
    logger.info('Workflow paused', { workflowId });
  }

  /**
   * Resume a workflow
   */
  async resumeWorkflow(workflowId: string): Promise<void> {
    const handle = await this.getWorkflowHandle(workflowId);
    await handle.signal(resumeSignal);
    logger.info('Workflow resumed', { workflowId });
  }

  /**
   * Cancel a workflow
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    const handle = await this.getWorkflowHandle(workflowId);
    await handle.signal(cancelSignal);
    logger.info('Workflow cancelled', { workflowId });
  }

  /**
   * Wait for workflow completion
   */
  async waitForWorkflowCompletion(workflowId: string): Promise<WorkflowResult> {
    const handle = await this.getWorkflowHandle(workflowId);
    return await handle.result();
  }

  /**
   * List running workflows
   */
  async listWorkflows(): Promise<Array<{ workflowId: string; runId: string; status: string }>> {
    if (!this.client) {
      throw new Error('Temporal client not initialized');
    }

    try {
      const workflows = [];
      for await (const workflow of this.client.workflow.list()) {
        workflows.push({
          workflowId: workflow.workflowId,
          runId: workflow.runId,
          status: workflow.status.name,
        });
      }
      return workflows;
    } catch (error) {
      logger.error('Failed to list workflows', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Get client health status
   */
  getHealthStatus(): { isConnected: boolean; namespace: string } {
    return {
      isConnected: this.client !== null && this.connection !== null,
      namespace: this.namespace,
    };
  }

  /**
   * Close the Temporal client
   */
  async close(): Promise<void> {
    try {
      logger.info('Closing Temporal client');

      if (this.connection) {
        this.connection.close();
        this.connection = null;
      }

      this.client = null;
      logger.info('Temporal client closed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to close Temporal client', { error: errorMessage });
      throw new Error(`Temporal client close failed: ${errorMessage}`);
    }
  }
}
