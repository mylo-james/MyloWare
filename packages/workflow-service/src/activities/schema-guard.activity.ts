/**
 * SchemaGuard Activity
 *
 * Validates data against defined schemas and sanitizes input.
 * This activity ensures data integrity and compliance with expected formats.
 */

import { Context, log } from '@temporalio/activity';
import { createLogger } from '@myloware/shared';
import Joi from 'joi';
import type { SchemaGuardInput, SchemaGuardOutput } from '../types/workflow';

const logger = createLogger('workflow-service:schema-guard');

// Define validation schemas for different document types
const invoiceSchema = Joi.object({
  id: Joi.string().required(),
  amount: Joi.object({
    value: Joi.number().positive().required(),
    currency: Joi.string().length(3).required(),
  }).required(),
  date: Joi.string().isoDate().required(),
  vendor: Joi.object({
    name: Joi.string().required(),
    id: Joi.string().allow(null),
  }).required(),
  lineItems: Joi.array()
    .items(
      Joi.object({
        id: Joi.number().integer().positive().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().positive().required(),
        unitPrice: Joi.number().min(0).required(),
        totalPrice: Joi.number().min(0).required(),
      })
    )
    .min(1)
    .required(),
  metadata: Joi.object().unknown(),
});

const ticketSchema = Joi.object({
  id: Joi.string().required(),
  title: Joi.string().min(1).required(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').required(),
  status: Joi.string().valid('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED').required(),
  description: Joi.string().allow(''),
  category: Joi.string().required(),
  assignee: Joi.string().allow(null),
  timestamps: Joi.object({
    created: Joi.string().isoDate().required(),
    updated: Joi.string().isoDate().required(),
  }).required(),
  metadata: Joi.object().unknown(),
});

const statusReportSchema = Joi.object({
  id: Joi.string().required(),
  title: Joi.string().min(1).required(),
  period: Joi.string().required(),
  status: Joi.string().valid('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'PUBLISHED').required(),
  summary: Joi.string().allow(''),
  metrics: Joi.object({
    completed: Joi.number().integer().min(0).required(),
    inProgress: Joi.number().integer().min(0).required(),
    issues: Joi.number().integer().min(0).required(),
    total: Joi.number().integer().min(0).required(),
  }).required(),
  timestamps: Joi.object({
    created: Joi.string().isoDate().required(),
    transformed: Joi.string().isoDate().required(),
  }).required(),
  metadata: Joi.object().unknown(),
});

const schemas = {
  invoice: invoiceSchema,
  ticket: ticketSchema,
  status_report: statusReportSchema,
};

export async function schemaGuardActivity(input: SchemaGuardInput): Promise<SchemaGuardOutput> {
  const { workItemId, data, schemaId, attemptId } = input;

  log.info('Starting SchemaGuard activity', {
    workItemId,
    schemaId,
    attemptId,
    activityId: Context.current().info.activityId,
  });

  try {
    logger.info('Validating data against schema', { workItemId, schemaId, attemptId });

    // Get the appropriate schema
    const schema = schemas[schemaId as keyof typeof schemas];
    if (!schema) {
      throw new Error(`Unknown schema ID: ${schemaId}`);
    }

    // Heartbeat before validation
    Context.current().heartbeat({
      workItemId,
      status: 'validating',
      schemaId,
    });

    // Validate the data
    const validationResult = schema.validate(data, {
      abortEarly: false, // Collect all validation errors
      allowUnknown: false, // Don't allow unknown properties
      stripUnknown: true, // Remove unknown properties
    });

    if (validationResult.error) {
      const validationErrors = validationResult.error.details.map(detail => detail.message);

      log.warn('Schema validation failed', {
        workItemId,
        schemaId,
        attemptId,
        errorCount: validationErrors.length,
        errors: validationErrors,
      });

      return {
        success: false,
        validationErrors,
      };
    }

    // Data is valid, return sanitized version
    const sanitizedData = validationResult.value;

    // Simulate potential guard failures
    if (Math.random() < 0.01) {
      // 1% chance of failure
      throw new Error(`Schema validation failed for ${schemaId}: Internal validation error`);
    }

    Context.current().heartbeat({
      workItemId,
      status: 'completed',
      validationPassed: true,
    });

    const result: SchemaGuardOutput = {
      success: true,
      sanitizedData,
    };

    log.info('SchemaGuard activity completed successfully', {
      workItemId,
      schemaId,
      attemptId,
    });

    logger.info('Schema validation passed', {
      workItemId,
      schemaId,
      sanitizedKeys: Object.keys(sanitizedData),
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error in SchemaGuard';

    log.error('SchemaGuard activity failed', {
      workItemId,
      schemaId,
      attemptId,
      error: errorMessage,
      activityId: Context.current().info.activityId,
    });

    logger.error('Schema validation failed', { workItemId, schemaId, error: errorMessage });

    return {
      success: false,
      validationErrors: [errorMessage],
    };
  }
}
