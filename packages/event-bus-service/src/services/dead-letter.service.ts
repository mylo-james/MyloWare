/**
 * Dead Letter Service
 *
 * Manages dead letter queue for failed events with reprocessing capabilities.
 */

import Redis from 'ioredis';
import { createLogger } from '@myloware/shared';
import type { DeadLetterEntry } from '../types/events';
import { DEFAULT_EVENT_BUS_CONFIG } from '../types/events';

const logger = createLogger('event-bus-service:dead-letter');

export class DeadLetterService {
  private redis: Redis;
  private isProcessing = false;
  private processingTimer: NodeJS.Timeout | null = null;

  constructor(private readonly redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', error => {
      logger.error('Redis connection error', { error: error.message });
    });

    this.redis.on('connect', () => {
      logger.info('Redis connection established for dead letter service');
    });
  }

  /**
   * Initialize the dead letter service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing dead letter service');

      await this.redis.connect();

      // Create dead letter stream if it doesn't exist
      const deadLetterStream = DEFAULT_EVENT_BUS_CONFIG.streams.deadLetter.streamName;

      try {
        await this.redis.xgroup(
          'CREATE',
          deadLetterStream,
          'dead_letter_processors',
          '0',
          'MKSTREAM'
        );
        logger.info('Dead letter consumer group created');
      } catch (error) {
        if (error instanceof Error && error.message.includes('BUSYGROUP')) {
          logger.debug('Dead letter consumer group already exists');
        } else {
          throw error;
        }
      }

      // Start periodic processing of dead letter queue
      this.startPeriodicProcessing();

      logger.info('Dead letter service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize dead letter service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get dead letter queue statistics
   */
  async getDeadLetterStats(): Promise<{
    totalEntries: number;
    oldestEntry?: string;
    newestEntry?: string;
    processingEnabled: boolean;
  }> {
    try {
      const deadLetterStream = DEFAULT_EVENT_BUS_CONFIG.streams.deadLetter.streamName;

      const info = (await this.redis.xinfo('STREAM', deadLetterStream)) as any[];
      const length = info[1] as number;
      const firstEntry = info[5] ? (info[5] as any[])[0] : undefined;
      const lastEntry = info[7] ? (info[7] as any[])[0] : undefined;

      return {
        totalEntries: length,
        oldestEntry: firstEntry,
        newestEntry: lastEntry,
        processingEnabled: this.isProcessing,
      };
    } catch (error) {
      logger.error('Failed to get dead letter stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        totalEntries: 0,
        processingEnabled: this.isProcessing,
      };
    }
  }

  /**
   * Reprocess events from dead letter queue
   */
  async reprocessEvents(limit: number = 10): Promise<{
    processed: number;
    failed: number;
    errors?: string[];
  }> {
    try {
      logger.info('Starting dead letter queue reprocessing', { limit });

      const deadLetterStream = DEFAULT_EVENT_BUS_CONFIG.streams.deadLetter.streamName;

      // Read entries from dead letter queue
      const results = await this.redis.xreadgroup(
        'GROUP',
        'dead_letter_processors',
        'reprocessor',
        'COUNT',
        limit,
        'STREAMS',
        deadLetterStream,
        '>'
      );

      if (!results || results.length === 0) {
        return { processed: 0, failed: 0 };
      }

      let processed = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const [streamName, messages] of results as any[]) {
        for (const [messageId, fields] of messages) {
          try {
            // Parse dead letter entry
            const fieldMap: Record<string, string> = {};
            for (let i = 0; i < fields.length; i += 2) {
              const key = fields[i];
              const value = fields[i + 1];
              if (key && value) {
                fieldMap[key] = value;
              }
            }

            const originalEventId = fieldMap['originalEventId'];
            const eventType = fieldMap['eventType'];
            const eventData = JSON.parse(fieldMap['eventData'] || '{}');
            const originalStream = fieldMap['originalStream'];

            if (!originalEventId || !eventType || !originalStream) {
              logger.error('Invalid dead letter entry - missing required fields', { messageId });
              continue;
            }

            logger.debug('Reprocessing dead letter entry', {
              messageId,
              originalEventId,
              eventType,
              originalStream,
            });

            // Attempt to republish to original stream
            await this.redis.xadd(
              originalStream,
              'MAXLEN',
              '~',
              10000, // Use reasonable max length
              '*',
              'eventType',
              eventType,
              'eventData',
              JSON.stringify(eventData),
              'reprocessedFrom',
              messageId,
              'reprocessedAt',
              new Date().toISOString()
            );

            // Acknowledge the dead letter message
            await this.redis.xack(deadLetterStream, 'dead_letter_processors', messageId);

            processed++;
            logger.info('Dead letter entry reprocessed successfully', {
              originalEventId,
              eventType,
              originalStream,
            });
          } catch (error) {
            failed++;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`${messageId}: ${errorMessage}`);

            logger.error('Failed to reprocess dead letter entry', {
              messageId,
              error: errorMessage,
            });
          }
        }
      }

      logger.info('Dead letter queue reprocessing completed', {
        processed,
        failed,
        errorCount: errors.length,
      });

      const result: { processed: number; failed: number; errors?: string[] } = {
        processed,
        failed,
      };

      if (errors.length > 0) {
        result.errors = errors;
      }

      return result;
    } catch (error) {
      logger.error('Failed to reprocess dead letter queue', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Clear old entries from dead letter queue
   */
  async clearOldEntries(olderThanDays: number = 30): Promise<number> {
    try {
      const deadLetterStream = DEFAULT_EVENT_BUS_CONFIG.streams.deadLetter.streamName;
      const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

      // Use XTRIM to remove old entries
      const removed = await this.redis.xtrim(deadLetterStream, 'MINID', cutoffTime.toString());

      logger.info('Old dead letter entries cleared', {
        removed,
        olderThanDays,
        cutoffTime: new Date(cutoffTime).toISOString(),
      });

      return removed;
    } catch (error) {
      logger.error('Failed to clear old dead letter entries', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Start periodic processing of dead letter queue
   */
  private startPeriodicProcessing(): void {
    const intervalMs = 5 * 60 * 1000; // 5 minutes

    this.processingTimer = setInterval(async () => {
      if (!this.isProcessing) {
        this.isProcessing = true;
        try {
          const stats = await this.getDeadLetterStats();
          if (stats.totalEntries > 0) {
            logger.info('Periodic dead letter processing', {
              totalEntries: stats.totalEntries,
            });

            // Reprocess a small batch
            await this.reprocessEvents(5);
          }
        } catch (error) {
          logger.error('Periodic dead letter processing failed', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          this.isProcessing = false;
        }
      }
    }, intervalMs);

    logger.info('Periodic dead letter processing started', { intervalMs });
  }

  /**
   * Stop the dead letter service
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping dead letter service');

      if (this.processingTimer) {
        clearInterval(this.processingTimer);
        this.processingTimer = null;
      }

      await this.redis.quit();

      logger.info('Dead letter service stopped successfully');
    } catch (error) {
      logger.error('Error stopping dead letter service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus(): { isConnected: boolean; isProcessing: boolean } {
    return {
      isConnected: this.redis.status === 'ready',
      isProcessing: this.isProcessing,
    };
  }
}
