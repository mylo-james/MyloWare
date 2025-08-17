/**
 * Persister Activity
 *
 * Persists validated data to the database.
 * This activity handles the final data storage step in the workflow.
 */

import { Context, log } from '@temporalio/activity';
import { createLogger } from '@myloware/shared';
import type { PersisterInput, PersisterOutput } from '../types/workflow';

const logger = createLogger('workflow-service:persister');

export async function persisterActivity(input: PersisterInput): Promise<PersisterOutput> {
  const { workItemId, validatedData, attemptId } = input;

  log.info('Starting Persister activity', {
    workItemId,
    attemptId,
    activityId: Context.current().info.activityId,
  });

  try {
    logger.info('Persisting validated data to database', { workItemId, attemptId });

    // Simulate database persistence
    // In a real implementation, this would:
    // 1. Connect to PostgreSQL database
    // 2. Insert validated data into appropriate tables
    // 3. Update work_item status to COMPLETED
    // 4. Update attempt record with results
    // 5. Return the persisted record ID

    // Heartbeat before persistence
    Context.current().heartbeat({
      workItemId,
      status: 'persisting',
      dataSize: JSON.stringify(validatedData).length,
    });

    // Simulate persistence time based on data size
    const dataSize = JSON.stringify(validatedData).length;
    const persistenceTime = Math.min(dataSize / 1000, 2000); // Max 2 seconds
    await new Promise(resolve => setTimeout(resolve, persistenceTime));

    // Generate a realistic record ID
    const persistedRecordId = `${workItemId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Simulate potential persistence failures
    if (Math.random() < 0.02) {
      // 2% chance of failure
      throw new Error(`Database persistence failed: Connection timeout`);
    }

    // Simulate database constraint violations
    if (Math.random() < 0.01) {
      // 1% chance of constraint violation
      throw new Error(`Database persistence failed: Unique constraint violation`);
    }

    Context.current().heartbeat({
      workItemId,
      status: 'completed',
      persistedRecordId,
    });

    const result: PersisterOutput = {
      success: true,
      persistedRecordId,
    };

    log.info('Persister activity completed successfully', {
      workItemId,
      attemptId,
      persistedRecordId,
      dataSize,
    });

    logger.info('Data persistence completed', {
      workItemId,
      persistedRecordId,
      dataSize,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error in Persister';

    log.error('Persister activity failed', {
      workItemId,
      attemptId,
      error: errorMessage,
      activityId: Context.current().info.activityId,
    });

    logger.error('Data persistence failed', { workItemId, error: errorMessage });

    return {
      success: false,
      error: errorMessage,
    };
  }
}
