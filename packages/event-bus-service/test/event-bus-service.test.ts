/**
 * Event Bus Service Tests
 */

import { EventPublisher } from '../src/publishers/event.publisher';
import { DEFAULT_EVENT_BUS_CONFIG } from '../src/types/events';

describe('Event Bus Service', () => {
  describe('Configuration', () => {
    it('should have proper default configuration', () => {
      expect(DEFAULT_EVENT_BUS_CONFIG).toBeDefined();
      expect(DEFAULT_EVENT_BUS_CONFIG.redisUrl).toBe('redis://localhost:6379');
      expect(DEFAULT_EVENT_BUS_CONFIG.streams).toBeDefined();
      expect(DEFAULT_EVENT_BUS_CONFIG.consumers).toBeDefined();
    });

    it('should have all required streams configured', () => {
      const streams = DEFAULT_EVENT_BUS_CONFIG.streams;
      expect(streams.workOrders).toBeDefined();
      expect(streams.workItems).toBeDefined();
      expect(streams.attempts).toBeDefined();
      expect(streams.system).toBeDefined();
      expect(streams.deadLetter).toBeDefined();
    });
  });

  describe('EventPublisher', () => {
    it('should initialize with proper configuration', () => {
      const config = {
        streamName: 'test-stream',
        maxLength: 1000,
        batchSize: 10,
        flushInterval: 1000,
      };

      expect(() => new EventPublisher(config, 'redis://localhost:6379')).not.toThrow();
    });

    it('should provide health status', () => {
      const config = {
        streamName: 'test-stream',
        maxLength: 1000,
        batchSize: 10,
        flushInterval: 1000,
      };

      const publisher = new EventPublisher(config, 'redis://localhost:6379');
      const health = publisher.getHealthStatus();

      expect(health).toHaveProperty('isConnected');
      expect(health).toHaveProperty('outboxSize');
      expect(health).toHaveProperty('streamName');
      expect(health.streamName).toBe('test-stream');
    });
  });
});
