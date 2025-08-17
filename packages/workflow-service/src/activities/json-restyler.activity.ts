/**
 * JsonRestyler Activity
 *
 * Transforms extracted data to consistent JSON format based on target schema.
 * This activity normalizes and restructures data to match expected formats.
 */

import { Context, log } from '@temporalio/activity';
import { createLogger } from '@myloware/shared';
import type { JsonRestylerInput, JsonRestylerOutput } from '../types/workflow';

const logger = createLogger('workflow-service:json-restyler');

export async function jsonRestylerActivity(input: JsonRestylerInput): Promise<JsonRestylerOutput> {
  const { workItemId, rawData, targetSchema, attemptId } = input;

  log.info('Starting JsonRestyler activity', {
    workItemId,
    targetSchema,
    attemptId,
    activityId: Context.current().info.activityId,
  });

  try {
    logger.info('Transforming data to target schema', { workItemId, targetSchema, attemptId });

    const transformations: string[] = [];
    let styledData: any;

    // Simulate transformation based on target schema
    switch (targetSchema) {
      case 'invoice':
        styledData = {
          id: rawData.invoiceNumber || `INV-${Date.now()}`,
          amount: {
            value: parseFloat(rawData.amount) || 0,
            currency: rawData.currency || 'USD',
          },
          date: rawData.date || new Date().toISOString().split('T')[0],
          vendor: {
            name: rawData.vendor || 'Unknown Vendor',
            id: null,
          },
          lineItems: (rawData.items || []).map((item: any, index: number) => ({
            id: index + 1,
            description: item.description || 'Unknown Item',
            quantity: parseInt(item.quantity) || 1,
            unitPrice: parseFloat(item.unitPrice) || 0,
            totalPrice: (parseInt(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0),
          })),
          metadata: {
            originalFormat: 'extracted',
            transformedAt: new Date().toISOString(),
          },
        };
        transformations.push(
          'Normalized amount format',
          'Structured vendor information',
          'Calculated line item totals'
        );
        break;

      case 'ticket':
        styledData = {
          id: rawData.ticketId || `TKT-${Date.now()}`,
          title: rawData.title || 'Untitled Ticket',
          priority: rawData.priority || 'MEDIUM',
          status: rawData.status || 'OPEN',
          description: rawData.description || '',
          category: rawData.category || 'General',
          assignee: rawData.assignee || null,
          timestamps: {
            created: rawData.createdDate || new Date().toISOString(),
            updated: new Date().toISOString(),
          },
          metadata: {
            originalFormat: 'extracted',
            transformedAt: new Date().toISOString(),
          },
        };
        transformations.push(
          'Structured timestamp format',
          'Normalized priority values',
          'Added metadata tracking'
        );
        break;

      case 'status_report':
        styledData = {
          id: rawData.reportId || `RPT-${Date.now()}`,
          title: rawData.title || 'Untitled Report',
          period: rawData.period || 'Unknown',
          status: rawData.status || 'DRAFT',
          summary: rawData.summary || '',
          metrics: {
            completed: rawData.metrics?.tasksCompleted || 0,
            inProgress: rawData.metrics?.tasksInProgress || 0,
            issues: rawData.metrics?.issuesFound || 0,
            total: (rawData.metrics?.tasksCompleted || 0) + (rawData.metrics?.tasksInProgress || 0),
          },
          timestamps: {
            created: rawData.createdDate || new Date().toISOString(),
            transformed: new Date().toISOString(),
          },
          metadata: {
            originalFormat: 'extracted',
            transformedAt: new Date().toISOString(),
          },
        };
        transformations.push(
          'Calculated total metrics',
          'Structured timestamp format',
          'Added computed fields'
        );
        break;

      default:
        throw new Error(`Unsupported target schema: ${targetSchema}`);
    }

    // Heartbeat during transformation
    Context.current().heartbeat({
      workItemId,
      status: 'transforming',
      transformationsApplied: transformations.length,
    });

    // Simulate potential transformation failures
    if (Math.random() < 0.02) {
      // 2% chance of failure
      throw new Error(
        `JSON transformation failed for schema ${targetSchema}: Invalid data structure`
      );
    }

    const result: JsonRestylerOutput = {
      success: true,
      styledData,
      transformations,
    };

    log.info('JsonRestyler activity completed successfully', {
      workItemId,
      targetSchema,
      attemptId,
      transformationsCount: transformations.length,
    });

    logger.info('JSON transformation completed', {
      workItemId,
      targetSchema,
      transformations,
      outputKeys: Object.keys(styledData),
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error in JsonRestyler';

    log.error('JsonRestyler activity failed', {
      workItemId,
      targetSchema,
      attemptId,
      error: errorMessage,
      activityId: Context.current().info.activityId,
    });

    logger.error('JSON transformation failed', { workItemId, targetSchema, error: errorMessage });

    return {
      success: false,
      styledData: null,
      transformations: [],
      error: errorMessage,
    };
  }
}
