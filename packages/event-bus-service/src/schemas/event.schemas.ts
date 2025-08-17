/**
 * Event Validation Schemas
 *
 * Joi schemas for validating event data structure and content.
 */

import Joi from 'joi';

// Base Event Schema
export const baseEventSchema = Joi.object({
  id: Joi.string().uuid().required(),
  type: Joi.string().required(),
  timestamp: Joi.string().isoDate().required(),
  version: Joi.string().required(),
  source: Joi.string().required(),
  correlationId: Joi.string().uuid().optional(),
  causationId: Joi.string().uuid().optional(),
  metadata: Joi.object().unknown().optional(),
});

// Work Order Event Schemas
export const workOrderCreatedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').required(),
  itemCount: Joi.number().integer().min(0).required(),
  metadata: Joi.object().unknown().optional(),
});

export const workOrderStatusChangedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  oldStatus: Joi.string().valid('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED').required(),
  newStatus: Joi.string().valid('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED').required(),
  reason: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

// Work Item Event Schemas
export const workItemProcessingStartedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  type: Joi.string().valid('INVOICE', 'TICKET', 'STATUS_REPORT').required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

export const workItemProcessingCompletedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  result: Joi.any().required(),
  processingTime: Joi.number().min(0).required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

export const workItemProcessingFailedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  error: Joi.string().required(),
  retryCount: Joi.number().integer().min(0).required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

// Attempt Event Schemas
export const attemptStartedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  attemptId: Joi.string().required(),
  activityName: Joi.string().required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

export const attemptCompletedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  attemptId: Joi.string().required(),
  activityName: Joi.string().required(),
  result: Joi.any().required(),
  duration: Joi.number().min(0).required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

export const attemptFailedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  attemptId: Joi.string().required(),
  activityName: Joi.string().required(),
  error: Joi.string().required(),
  retryCount: Joi.number().integer().min(0).required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

export const attemptRetriedDataSchema = Joi.object({
  workOrderId: Joi.string().required(),
  workItemId: Joi.string().required(),
  attemptId: Joi.string().required(),
  activityName: Joi.string().required(),
  retryCount: Joi.number().integer().min(0).required(),
  nextRetryAt: Joi.string().isoDate().required(),
  agentId: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

// System Event Schemas
export const systemHealthCheckDataSchema = Joi.object({
  service: Joi.string().required(),
  status: Joi.string().valid('healthy', 'unhealthy').required(),
  timestamp: Joi.string().isoDate().required(),
  checks: Joi.object().pattern(Joi.string(), Joi.boolean()).required(),
  metadata: Joi.object().unknown().optional(),
});

export const systemErrorDataSchema = Joi.object({
  service: Joi.string().required(),
  error: Joi.string().required(),
  severity: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  stackTrace: Joi.string().optional(),
  metadata: Joi.object().unknown().optional(),
});

export const systemMaintenanceDataSchema = Joi.object({
  service: Joi.string().required(),
  maintenanceType: Joi.string().valid('scheduled', 'emergency').required(),
  startTime: Joi.string().isoDate().required(),
  estimatedDuration: Joi.number().min(0).required(),
  description: Joi.string().required(),
  metadata: Joi.object().unknown().optional(),
});

// Complete Event Schemas (base + data)
export const workOrderCreatedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('work_order.created').required(),
  data: workOrderCreatedDataSchema.required(),
});

export const workOrderStatusChangedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('work_order.status_changed').required(),
  data: workOrderStatusChangedDataSchema.required(),
});

export const workItemProcessingStartedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('work_item.processing_started').required(),
  data: workItemProcessingStartedDataSchema.required(),
});

export const workItemProcessingCompletedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('work_item.processing_completed').required(),
  data: workItemProcessingCompletedDataSchema.required(),
});

export const workItemProcessingFailedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('work_item.processing_failed').required(),
  data: workItemProcessingFailedDataSchema.required(),
});

export const attemptStartedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('attempt.started').required(),
  data: attemptStartedDataSchema.required(),
});

export const attemptCompletedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('attempt.completed').required(),
  data: attemptCompletedDataSchema.required(),
});

export const attemptFailedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('attempt.failed').required(),
  data: attemptFailedDataSchema.required(),
});

export const attemptRetriedEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('attempt.retried').required(),
  data: attemptRetriedDataSchema.required(),
});

export const systemHealthCheckEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('system.health_check').required(),
  data: systemHealthCheckDataSchema.required(),
});

export const systemErrorEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('system.error').required(),
  data: systemErrorDataSchema.required(),
});

export const systemMaintenanceEventSchema = baseEventSchema.keys({
  type: Joi.string().valid('system.maintenance').required(),
  data: systemMaintenanceDataSchema.required(),
});

// Schema Registry
export const EVENT_SCHEMAS = {
  'work_order.created': workOrderCreatedEventSchema,
  'work_order.status_changed': workOrderStatusChangedEventSchema,
  'work_item.processing_started': workItemProcessingStartedEventSchema,
  'work_item.processing_completed': workItemProcessingCompletedEventSchema,
  'work_item.processing_failed': workItemProcessingFailedEventSchema,
  'attempt.started': attemptStartedEventSchema,
  'attempt.completed': attemptCompletedEventSchema,
  'attempt.failed': attemptFailedEventSchema,
  'attempt.retried': attemptRetriedEventSchema,
  'system.health_check': systemHealthCheckEventSchema,
  'system.error': systemErrorEventSchema,
  'system.maintenance': systemMaintenanceEventSchema,
} as const;

// Validation function
export function validateEvent(
  eventType: string,
  event: any
): { isValid: boolean; errors?: string[] } {
  const schema = EVENT_SCHEMAS[eventType as keyof typeof EVENT_SCHEMAS];

  if (!schema) {
    return {
      isValid: false,
      errors: [`Unknown event type: ${eventType}`],
    };
  }

  const validationResult = schema.validate(event, {
    abortEarly: false,
    allowUnknown: false,
  });

  if (validationResult.error) {
    return {
      isValid: false,
      errors: validationResult.error.details.map(detail => detail.message),
    };
  }

  return { isValid: true };
}
