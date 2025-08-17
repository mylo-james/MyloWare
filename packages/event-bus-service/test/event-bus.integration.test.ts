/**
 * Event Bus Service Integration Tests
 */

import { EVENT_TYPES, DEFAULT_EVENT_BUS_CONFIG } from '../src/types/events';
import { validateEvent } from '../src/schemas/event.schemas';

describe('Event Bus Service Integration', () => {
  it('should have all event types defined', () => {
    expect(EVENT_TYPES.WORK_ORDER_CREATED).toBe('work_order.created');
    expect(EVENT_TYPES.WORK_ITEM_PROCESSING_STARTED).toBe('work_item.processing_started');
    expect(EVENT_TYPES.ATTEMPT_COMPLETED).toBe('attempt.completed');
    expect(EVENT_TYPES.SYSTEM_ERROR).toBe('system.error');
  });

  it('should have proper default configuration', () => {
    expect(DEFAULT_EVENT_BUS_CONFIG.redisUrl).toBe('redis://localhost:6379');
    expect(DEFAULT_EVENT_BUS_CONFIG.streams.workOrders.streamName).toBe('myloware:work_orders');
    expect(DEFAULT_EVENT_BUS_CONFIG.outbox.batchSize).toBe(100);
    expect(DEFAULT_EVENT_BUS_CONFIG.consumers['workOrderProcessor']).toBeDefined();
  });

  it('should validate work order created events correctly', () => {
    const validEvent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'work_order.created',
      timestamp: new Date().toISOString(),
      version: '1.0',
      source: 'workflow-service',
      data: {
        workOrderId: 'order-123',
        priority: 'HIGH',
        itemCount: 5,
      },
    };

    const result = validateEvent('work_order.created', validEvent);
    expect(result.isValid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('should reject invalid events', () => {
    const invalidEvent = {
      id: 'invalid-uuid',
      type: 'work_order.created',
      // Missing required fields
    };

    const result = validateEvent('work_order.created', invalidEvent);
    expect(result.isValid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('should reject unknown event types', () => {
    const event = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'unknown.event',
      timestamp: new Date().toISOString(),
      version: '1.0',
      source: 'test',
      data: {},
    };

    const result = validateEvent('unknown.event', event);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Unknown event type: unknown.event');
  });
});
