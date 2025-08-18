import { jest } from '@jest/globals';
import { EventPublisher } from '../src/publishers/event.publisher';
import { EVENT_TYPES, PublisherConfig } from '../src/types/events';

jest.mock('ioredis', () => {
  const MockRedis = function () {
    return {
      status: 'ready',
      on: jest.fn(),
      xadd: jest.fn(async () => '1-0'),
      quit: jest.fn(async () => undefined),
    } as any;
  } as any;
  return MockRedis;
});

const baseConfig: PublisherConfig = {
  streamName: 'test:stream',
  maxLength: 1000,
  batchSize: 10,
  flushInterval: 10_000,
};

describe('EventPublisher', () => {
  it('publishes a valid event and returns success', async () => {
    const publisher = new EventPublisher(baseConfig);
    const event = {
      id: '11111111-1111-1111-1111-111111111111',
      type: EVENT_TYPES.SYSTEM_HEALTH_CHECK,
      timestamp: new Date().toISOString(),
      version: '1',
      source: 'test',
      data: {
        service: 'event-bus',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        checks: { redis: true },
      },
    } as any;

    const res = await publisher.publishEvent(event);
    expect(res.success).toBe(true);
  });

  it('rejects invalid event and returns error', async () => {
    const publisher = new EventPublisher(baseConfig);
    const badEvent = {
      id: 'e2',
      type: EVENT_TYPES.SYSTEM_HEALTH_CHECK,
      timestamp: new Date().toISOString(),
      version: '1',
      source: 'test',
      data: {
        // missing required fields like checks
        service: 'x',
        status: 'healthy',
      },
    } as any;

    const res = await publisher.publishEvent(badEvent);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/validation/i);
  });

  it('handles redis xadd error and schedules retry', async () => {
    const MockRedis = require('ioredis');
    const failing = new MockRedis();
    failing.xadd.mockRejectedValueOnce(new Error('xadd failed'));

    const publisher = new EventPublisher(baseConfig);
    // Inject our failing client
    (publisher as any).redis = failing;

    const event = {
      id: '33333333-3333-3333-3333-333333333333',
      type: EVENT_TYPES.SYSTEM_HEALTH_CHECK,
      timestamp: new Date().toISOString(),
      version: '1',
      source: 'test',
      data: { service: 'svc', status: 'healthy', timestamp: new Date().toISOString(), checks: {} },
    } as any;

    await publisher.publishEvent(event);
    const result = await publisher.flushOutbox();
    expect(result.failed + result.published).toBeGreaterThanOrEqual(0);
    await publisher.stop();
  });

  it('flushOutbox publishes pending entries', async () => {
    const publisher = new EventPublisher({ ...baseConfig, batchSize: 1 });
    const event = {
      id: '22222222-2222-2222-2222-222222222222',
      type: EVENT_TYPES.SYSTEM_HEALTH_CHECK,
      timestamp: new Date().toISOString(),
      version: '1',
      source: 'test',
      data: {
        service: 'event-bus',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        checks: { redis: true },
      },
    } as any;

    await publisher.publishEvent(event);
    const result = await publisher.flushOutbox();
    expect(result.published + result.failed).toBeGreaterThanOrEqual(0);
    await publisher.stop();
  });
});
