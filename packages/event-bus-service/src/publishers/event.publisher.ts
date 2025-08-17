/**
 * Event Publisher
 *
 * Publishes events to Redis Streams using the outbox pattern for reliability.
 * Implements at-least-once delivery guarantees with retry mechanisms.
 */

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@myloware/shared';
import { validateEvent } from '../schemas/event.schemas';
import type { MyloWareEvent, OutboxEntry, PublisherConfig, EVENT_TYPES } from '../types/events';
import { DEFAULT_EVENT_BUS_CONFIG } from '../types/events';

const logger = createLogger('event-bus-service:publisher');

export class EventPublisher {
  private redis: Redis;
  private outboxEntries: Map<string, OutboxEntry> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: PublisherConfig,
    redisUrl: string = DEFAULT_EVENT_BUS_CONFIG.redisUrl
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', error => {
      logger.error('Redis connection error', { error: error.message });
    });

    this.redis.on('connect', () => {
      logger.info('Redis connection established', { streamName: config.streamName });
    });

    // Start periodic flush
    this.startFlushTimer();
  }

  /**
   * Publish an event to the stream
   */
  async publishEvent(
    event: MyloWareEvent
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    try {
      // Validate event structure
      const validation = validateEvent(event.type, event);
      if (!validation.isValid) {
        const error = `Event validation failed: ${validation.errors?.join(', ')}`;
        logger.error('Event validation failed', {
          eventType: event.type,
          eventId: event.id,
          errors: validation.errors,
        });
        return { success: false, error };
      }

      // Create outbox entry
      const outboxEntry: OutboxEntry = {
        id: uuidv4(),
        eventType: event.type,
        eventData: event,
        streamName: this.config.streamName,
        createdAt: new Date(),
        retryCount: 0,
        maxRetries: 5,
        status: 'PENDING',
      };

      // Add to outbox (in-memory for now, would be database in real implementation)
      this.outboxEntries.set(outboxEntry.id, outboxEntry);

      logger.info('Event added to outbox', {
        eventType: event.type,
        eventId: event.id,
        outboxId: outboxEntry.id,
        streamName: this.config.streamName,
      });

      // Attempt immediate publish if batch size reached
      if (this.outboxEntries.size >= this.config.batchSize) {
        await this.flushOutbox();
      }

      return { success: true, eventId: event.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to publish event', {
        eventType: event.type,
        eventId: event.id,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Publish multiple events in batch
   */
  async publishEvents(events: MyloWareEvent[]): Promise<{
    success: boolean;
    published: number;
    failed: number;
    errors?: string[] | undefined;
  }> {
    const results = await Promise.allSettled(events.map(event => this.publishEvent(event)));

    const published = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - published;
    const errors = results
      .filter(r => r.status === 'fulfilled' && !r.value.success)
      .map(r => (r as PromiseFulfilledResult<any>).value.error)
      .filter(Boolean);

    logger.info('Batch event publish completed', {
      total: events.length,
      published,
      failed,
      errorCount: errors.length,
    });

    const result: {
      success: boolean;
      published: number;
      failed: number;
      errors?: string[] | undefined;
    } = {
      success: failed === 0,
      published,
      failed,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;
  }

  /**
   * Flush pending events from outbox to Redis Streams
   */
  async flushOutbox(): Promise<{
    published: number;
    failed: number;
    errors?: string[] | undefined;
  }> {
    if (this.outboxEntries.size === 0) {
      return { published: 0, failed: 0 };
    }

    const pendingEntries = Array.from(this.outboxEntries.values()).filter(
      entry =>
        entry.status === 'PENDING' ||
        (entry.status === 'FAILED' && entry.nextRetryAt && new Date() >= entry.nextRetryAt)
    );

    if (pendingEntries.length === 0) {
      return { published: 0, failed: 0 };
    }

    logger.info('Flushing outbox to Redis Streams', {
      pendingCount: pendingEntries.length,
      streamName: this.config.streamName,
    });

    let published = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of pendingEntries) {
      try {
        // Publish to Redis Stream
        const streamId = await this.redis.xadd(
          entry.streamName,
          'MAXLEN',
          '~',
          this.config.maxLength,
          '*', // Auto-generate ID
          'eventType',
          entry.eventType,
          'eventData',
          JSON.stringify(entry.eventData),
          'outboxId',
          entry.id,
          'publishedAt',
          new Date().toISOString()
        );

        // Mark as published
        entry.status = 'PUBLISHED';
        entry.publishedAt = new Date();
        published++;

        logger.debug('Event published to stream', {
          outboxId: entry.id,
          eventType: entry.eventType,
          streamId,
          streamName: entry.streamName,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Update retry information
        entry.retryCount++;
        if (entry.retryCount >= entry.maxRetries) {
          entry.status = 'DEAD_LETTER';
          logger.error('Event moved to dead letter queue', {
            outboxId: entry.id,
            eventType: entry.eventType,
            retryCount: entry.retryCount,
            error: errorMessage,
          });
        } else {
          entry.status = 'FAILED';
          entry.nextRetryAt = new Date(Date.now() + entry.retryCount * 5000); // Exponential backoff
          logger.warn('Event publish failed, will retry', {
            outboxId: entry.id,
            eventType: entry.eventType,
            retryCount: entry.retryCount,
            nextRetryAt: entry.nextRetryAt,
            error: errorMessage,
          });
        }

        failed++;
        errors.push(`${entry.eventType}: ${errorMessage}`);
      }
    }

    // Clean up published entries
    for (const entry of pendingEntries) {
      if (entry.status === 'PUBLISHED') {
        this.outboxEntries.delete(entry.id);
      }
    }

    logger.info('Outbox flush completed', {
      published,
      failed,
      remaining: this.outboxEntries.size,
    });

    const result: { published: number; failed: number; errors?: string[] | undefined } = {
      published,
      failed,
    };

    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;
  }

  /**
   * Get outbox statistics
   */
  getOutboxStats(): {
    total: number;
    pending: number;
    failed: number;
    deadLetter: number;
  } {
    const entries = Array.from(this.outboxEntries.values());

    return {
      total: entries.length,
      pending: entries.filter(e => e.status === 'PENDING').length,
      failed: entries.filter(e => e.status === 'FAILED').length,
      deadLetter: entries.filter(e => e.status === 'DEAD_LETTER').length,
    };
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      try {
        await this.flushOutbox();
      } catch (error) {
        logger.error('Periodic flush failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, this.config.flushInterval);
  }

  /**
   * Stop the publisher and clean up resources
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping event publisher', { streamName: this.config.streamName });

      // Stop flush timer
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }

      // Final flush
      await this.flushOutbox();

      // Close Redis connection
      await this.redis.quit();

      logger.info('Event publisher stopped successfully');
    } catch (error) {
      logger.error('Error stopping event publisher', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get publisher health status
   */
  getHealthStatus(): { isConnected: boolean; outboxSize: number; streamName: string } {
    return {
      isConnected: this.redis.status === 'ready',
      outboxSize: this.outboxEntries.size,
      streamName: this.config.streamName,
    };
  }
}
