/**
 * RecordGen Activity
 *
 * Generates initial records and context for work order processing.
 * This activity creates the necessary database records and sets up
 * the context for subsequent workflow steps.
 */

import { Context, log } from '@temporalio/activity';
import { createLogger } from '@myloware/shared';
import type { RecordGenInput, RecordGenOutput } from '../types/workflow';

const logger = createLogger('workflow-service:record-gen');

export async function recordGenActivity(input: RecordGenInput): Promise<RecordGenOutput> {
  const { workOrderId, workItems } = input;

  log.info('Starting RecordGen activity', {
    workOrderId,
    itemCount: workItems.length,
    activityId: Context.current().info.activityId,
  });

  try {
    // Simulate record generation process
    // In a real implementation, this would:
    // 1. Create work_order record in database
    // 2. Create work_item records for each item
    // 3. Initialize attempt records
    // 4. Set up any required context or metadata

    let recordsCreated = 0;
    const errors: string[] = [];

    // Generate work order record
    logger.info('Creating work order record', { workOrderId });

    // Simulate database operation with potential failure
    if (Math.random() < 0.05) {
      // 5% chance of failure for testing
      errors.push(`Failed to create work order record: ${workOrderId}`);
    } else {
      recordsCreated++;
    }

    // Generate work item records
    for (const workItem of workItems) {
      logger.info('Creating work item record', {
        workOrderId,
        workItemId: workItem.workItemId,
        type: workItem.type,
      });

      // Simulate database operation with potential failure
      if (Math.random() < 0.02) {
        // 2% chance of failure per item
        errors.push(`Failed to create work item record: ${workItem.workItemId}`);
      } else {
        recordsCreated++;
      }

      // Heartbeat to keep activity alive for long operations
      Context.current().heartbeat({
        workItemId: workItem.workItemId,
        recordsCreated,
      });
    }

    // Initialize attempt records
    logger.info('Initializing attempt records', { workOrderId, itemCount: workItems.length });
    recordsCreated += workItems.length; // One attempt record per work item

    const result: RecordGenOutput = {
      success: errors.length === 0,
      recordsCreated,
      errors: errors.length > 0 ? errors : undefined,
    };

    if (result.success) {
      log.info('RecordGen activity completed successfully', {
        workOrderId,
        recordsCreated,
      });
    } else {
      log.warn('RecordGen activity completed with errors', {
        workOrderId,
        recordsCreated,
        errorCount: errors.length,
        errors,
      });
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error in RecordGen';

    log.error('RecordGen activity failed', {
      workOrderId,
      error: errorMessage,
      activityId: Context.current().info.activityId,
    });

    logger.error('RecordGen activity failed', { workOrderId, error: errorMessage });

    return {
      success: false,
      recordsCreated: 0,
      errors: [errorMessage],
    };
  }
}
