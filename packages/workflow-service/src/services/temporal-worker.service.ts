/**
 * Temporal Worker Service
 *
 * Manages Temporal workers that execute workflows and activities.
 * This service handles worker lifecycle, activity registration, and monitoring.
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import { createLogger } from '@myloware/shared';
import { DEFAULT_WORKFLOW_CONFIG } from '../types/workflow';
import * as activities from '../activities';

const logger = createLogger('workflow-service:temporal-worker');

export class TemporalWorkerService {
  private worker: Worker | null = null;
  private connection: NativeConnection | null = null;

  constructor(
    private readonly temporalHost: string = 'localhost',
    private readonly temporalPort: number = 7233,
    private readonly namespace: string = DEFAULT_WORKFLOW_CONFIG.namespace,
    private readonly taskQueue: string = DEFAULT_WORKFLOW_CONFIG.taskQueue
  ) {}

  /**
   * Initialize and start the Temporal worker
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting Temporal worker service', {
        host: this.temporalHost,
        port: this.temporalPort,
        namespace: this.namespace,
        taskQueue: this.taskQueue,
      });

      // Create connection to Temporal server
      this.connection = await NativeConnection.connect({
        address: `${this.temporalHost}:${this.temporalPort}`,
      });

      // Create worker with workflow and activity configurations
      this.worker = await Worker.create({
        connection: this.connection,
        namespace: this.namespace,
        taskQueue: this.taskQueue,
        workflowsPath: require.resolve('../workflows'),
        activities,
        maxConcurrentActivityTaskExecutions: 10,
        maxConcurrentWorkflowTaskExecutions: 5,
      });

      logger.info('Temporal worker created successfully', {
        namespace: this.namespace,
        taskQueue: this.taskQueue,
        activitiesCount: Object.keys(activities).length,
      });

      // Start the worker
      await this.worker.run();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to start Temporal worker', { error: errorMessage });
      throw new Error(`Temporal worker startup failed: ${errorMessage}`);
    }
  }

  /**
   * Stop the Temporal worker gracefully
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Temporal worker service');

      if (this.worker) {
        this.worker.shutdown();
        this.worker = null;
        logger.info('Temporal worker stopped');
      }

      if (this.connection) {
        this.connection.close();
        this.connection = null;
        logger.info('Temporal connection closed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to stop Temporal worker', { error: errorMessage });
      throw new Error(`Temporal worker shutdown failed: ${errorMessage}`);
    }
  }

  /**
   * Get worker health status
   */
  getHealthStatus(): { isRunning: boolean; namespace: string; taskQueue: string } {
    return {
      isRunning: this.worker !== null && this.connection !== null,
      namespace: this.namespace,
      taskQueue: this.taskQueue,
    };
  }

  /**
   * Get worker metrics
   */
  async getMetrics(): Promise<{
    activitiesRegistered: number;
    connectionStatus: 'connected' | 'disconnected';
    namespace: string;
    taskQueue: string;
  }> {
    return {
      activitiesRegistered: Object.keys(activities).length,
      connectionStatus: this.connection ? 'connected' : 'disconnected',
      namespace: this.namespace,
      taskQueue: this.taskQueue,
    };
  }
}
