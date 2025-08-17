/**
 * Event Consumer Service
 *
 * Consumes events from Redis Streams using consumer groups with at-least-once delivery.
 * Implements partitioning strategy and automatic failover.
 */

import Redis from 'ioredis';
import { createLogger } from '@myloware/shared';
import { validateEvent } from '../schemas/event.schemas';
import type { MyloWareEvent, ConsumerConfig, DeadLetterEntry } from '../types/events';
import { DEFAULT_EVENT_BUS_CONFIG } from '../types/events';

const logger = createLogger('event-bus-service:consumer');

export interface EventHandler {
  (event: MyloWareEvent): Promise<void>;
}

export class EventConsumerService {
  private redis: Redis;
  private consumers: Map<string, Redis> = new Map();
  private handlers: Map<string, EventHandler> = new Map();
  private isRunning = false;
  private consumerPromises: Promise<void>[] = [];

  constructor(
    private readonly redisUrl: string,
    private readonly consumerGroup: string
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', error => {
      logger.error('Redis connection error', { error: error.message });
    });

    this.redis.on('connect', () => {
      logger.info('Redis connection established for event consumer');
    });
  }

  /**
   * Initialize consumer groups for all streams
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing event consumer service');

      await this.redis.connect();

      // Create consumer groups for all streams
      const streams = Object.values(DEFAULT_EVENT_BUS_CONFIG.streams);

      for (const stream of streams) {
        try {
          await this.redis.xgroup(
            'CREATE',
            stream.streamName,
            stream.consumerGroup,
            '0',
            'MKSTREAM'
          );
          logger.info('Consumer group created', {
            stream: stream.streamName,
            group: stream.consumerGroup,
          });
        } catch (error) {
          // Group might already exist, which is fine
          if (error instanceof Error && error.message.includes('BUSYGROUP')) {
            logger.debug('Consumer group already exists', {
              stream: stream.streamName,
              group: stream.consumerGroup,
            });
          } else {
            throw error;
          }
        }
      }

      // Register default event handlers
      this.registerDefaultHandlers();

      logger.info('Event consumer service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize event consumer service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Register an event handler for a specific event type
   */
  registerHandler(eventType: string, handler: EventHandler): void {
    this.handlers.set(eventType, handler);
    logger.info('Event handler registered', { eventType });
  }

  /**
   * Start consuming events from all configured streams
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Event consumer service is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting event consumers');

    // Start consumers for each stream
    const consumerConfigs = Object.values(DEFAULT_EVENT_BUS_CONFIG.consumers);

    for (const config of consumerConfigs) {
      const consumerPromise = this.startConsumer(config);
      this.consumerPromises.push(consumerPromise);
    }

    logger.info('All event consumers started', {
      consumerCount: consumerConfigs.length,
    });
  }

  /**
   * Start a consumer for a specific configuration
   */
  private async startConsumer(config: ConsumerConfig): Promise<void> {
    const consumerRedis = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 3,
    });

    this.consumers.set(config.groupName, consumerRedis);

    logger.info('Starting consumer', {
      groupName: config.groupName,
      consumerName: config.consumerName,
      streams: config.streams,
    });

    while (this.isRunning) {
      try {
        // Read from multiple streams
        const streamArgs = config.streams.flatMap(stream => [stream, '>']);

        const results = await consumerRedis.xreadgroup(
          'GROUP',
          config.groupName,
          config.consumerName,
          'COUNT',
          config.batchSize,
          'BLOCK',
          config.blockTime,
          'STREAMS',
          ...streamArgs
        );

        if (results && results.length > 0) {
          await this.processStreamResults(results, config);
        }
      } catch (error) {
        if (this.isRunning) {
          logger.error('Consumer error', {
            groupName: config.groupName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, config.retryDelay));
        }
      }
    }

    await consumerRedis.quit();
  }

  /**
   * Process stream results from Redis
   */
  private async processStreamResults(results: any[], config: ConsumerConfig): Promise<void> {
    for (const [streamName, messages] of results) {
      logger.debug('Processing messages from stream', {
        streamName,
        messageCount: messages.length,
        groupName: config.groupName,
      });

      for (const [messageId, fields] of messages) {
        await this.processMessage(streamName, messageId, fields, config);
      }
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(
    streamName: string,
    messageId: string,
    fields: string[],
    config: ConsumerConfig
  ): Promise<void> {
    try {
      // Parse message fields
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];
        if (key && value) {
          fieldMap[key] = value;
        }
      }

      const eventType = fieldMap['eventType'];
      const eventData = JSON.parse(fieldMap['eventData'] || '{}');
      const outboxId = fieldMap['outboxId'];

      logger.debug('Processing event message', {
        streamName,
        messageId,
        eventType,
        outboxId,
      });

      // Validate event
      if (!eventType) {
        logger.error('Missing event type in message', { streamName, messageId });
        await this.acknowledgeMessage(streamName, config.groupName, messageId);
        return;
      }

      const validation = validateEvent(eventType, eventData);
      if (!validation.isValid) {
        logger.error('Invalid event received', {
          streamName,
          messageId,
          eventType,
          errors: validation.errors,
        });

        // Send to dead letter queue
        await this.sendToDeadLetterQueue({
          id: messageId,
          originalEventId: eventData.id || messageId,
          eventType,
          eventData,
          streamName,
          error: `Validation failed: ${validation.errors?.join(', ')}`,
          failedAt: new Date(),
          retryCount: 0,
        });

        // Acknowledge message to remove from stream
        await this.acknowledgeMessage(streamName, config.groupName, messageId);
        return;
      }

      // Get handler for event type
      const handler = this.handlers.get(eventType);
      if (!handler) {
        logger.warn('No handler registered for event type', {
          eventType,
          messageId,
          streamName,
        });

        // Acknowledge message since we can't process it
        await this.acknowledgeMessage(streamName, config.groupName, messageId);
        return;
      }

      // Process event with retry logic
      let retryCount = 0;
      let processed = false;

      while (retryCount <= config.retryAttempts && !processed) {
        try {
          await handler(eventData);
          processed = true;

          logger.debug('Event processed successfully', {
            eventType,
            messageId,
            streamName,
            retryCount,
          });
        } catch (error) {
          retryCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          if (retryCount > config.retryAttempts) {
            logger.error('Event processing failed after max retries', {
              eventType,
              messageId,
              streamName,
              retryCount,
              error: errorMessage,
            });

            // Send to dead letter queue
            await this.sendToDeadLetterQueue({
              id: messageId,
              originalEventId: eventData.id || messageId,
              eventType,
              eventData,
              streamName,
              error: errorMessage,
              failedAt: new Date(),
              retryCount,
            });
          } else {
            logger.warn('Event processing failed, retrying', {
              eventType,
              messageId,
              streamName,
              retryCount,
              maxRetries: config.retryAttempts,
              error: errorMessage,
            });

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, config.retryDelay * retryCount));
          }
        }
      }

      // Acknowledge message if processed or max retries exceeded
      if (processed || retryCount > config.retryAttempts) {
        await this.acknowledgeMessage(streamName, config.groupName, messageId);
      }
    } catch (error) {
      logger.error('Error processing message', {
        streamName,
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Acknowledge a message in the consumer group
   */
  private async acknowledgeMessage(
    streamName: string,
    groupName: string,
    messageId: string
  ): Promise<void> {
    try {
      await this.redis.xack(streamName, groupName, messageId);
      logger.debug('Message acknowledged', { streamName, groupName, messageId });
    } catch (error) {
      logger.error('Failed to acknowledge message', {
        streamName,
        groupName,
        messageId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send failed event to dead letter queue
   */
  private async sendToDeadLetterQueue(entry: DeadLetterEntry): Promise<void> {
    try {
      const deadLetterStream = DEFAULT_EVENT_BUS_CONFIG.streams.deadLetter.streamName;

      await this.redis.xadd(
        deadLetterStream,
        'MAXLEN',
        '~',
        DEFAULT_EVENT_BUS_CONFIG.streams.deadLetter.maxLength,
        '*',
        'originalEventId',
        entry.originalEventId,
        'eventType',
        entry.eventType,
        'eventData',
        JSON.stringify(entry.eventData),
        'originalStream',
        entry.streamName,
        'error',
        entry.error,
        'failedAt',
        entry.failedAt.toISOString(),
        'retryCount',
        entry.retryCount.toString()
      );

      logger.info('Event sent to dead letter queue', {
        originalEventId: entry.originalEventId,
        eventType: entry.eventType,
        originalStream: entry.streamName,
        deadLetterStream,
      });
    } catch (error) {
      logger.error('Failed to send event to dead letter queue', {
        originalEventId: entry.originalEventId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Register default event handlers
   */
  private registerDefaultHandlers(): void {
    // Work Order Events
    this.registerHandler('work_order.created', async event => {
      logger.info('Work order created', { eventData: event });
      // Default handler - would be replaced by actual business logic
    });

    this.registerHandler('work_order.status_changed', async event => {
      logger.info('Work order status changed', { eventData: event });
    });

    // Work Item Events
    this.registerHandler('work_item.processing_started', async event => {
      logger.info('Work item processing started', { eventData: event });
    });

    this.registerHandler('work_item.processing_completed', async event => {
      logger.info('Work item processing completed', { eventData: event });
    });

    this.registerHandler('work_item.processing_failed', async event => {
      logger.error('Work item processing failed', { eventData: event });
    });

    // Attempt Events
    this.registerHandler('attempt.started', async event => {
      logger.debug('Attempt started', { eventData: event });
    });

    this.registerHandler('attempt.completed', async event => {
      logger.debug('Attempt completed', { eventData: event });
    });

    this.registerHandler('attempt.failed', async event => {
      logger.warn('Attempt failed', { eventData: event });
    });

    // System Events
    this.registerHandler('system.health_check', async event => {
      logger.debug('System health check', { eventData: event });
    });

    this.registerHandler('system.error', async event => {
      logger.error('System error event', { eventData: event });
    });

    this.registerHandler('system.maintenance', async event => {
      logger.info('System maintenance event', { eventData: event });
    });

    logger.info('Default event handlers registered');
  }

  /**
   * Stop all consumers and clean up resources
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping event consumer service');

      this.isRunning = false;

      // Wait for all consumer loops to finish
      await Promise.all(this.consumerPromises);

      // Close all consumer Redis connections
      for (const [groupName, redis] of this.consumers) {
        await redis.quit();
        logger.debug('Consumer Redis connection closed', { groupName });
      }

      // Close main Redis connection
      await this.redis.quit();

      logger.info('Event consumer service stopped successfully');
    } catch (error) {
      logger.error('Error stopping event consumer service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get consumer health status
   */
  getHealthStatus(): {
    isRunning: boolean;
    consumerCount: number;
    handlerCount: number;
    redisConnected: boolean;
  } {
    return {
      isRunning: this.isRunning,
      consumerCount: this.consumers.size,
      handlerCount: this.handlers.size,
      redisConnected: this.redis.status === 'ready',
    };
  }

  /**
   * Get consumer statistics
   */
  async getConsumerStats(): Promise<{
    [groupName: string]: {
      pending: number;
      consumers: number;
      lastDelivered: string;
    };
  }> {
    const stats: any = {};

    try {
      const streams = Object.values(DEFAULT_EVENT_BUS_CONFIG.streams);

      for (const stream of streams) {
        const info = (await this.redis.xinfo('GROUPS', stream.streamName)) as any[];

        for (const groupInfo of info) {
          if (Array.isArray(groupInfo) && groupInfo.length >= 8) {
            const groupName = groupInfo[1];
            const pending = groupInfo[3];
            const consumers = groupInfo[7];
            const lastDelivered = groupInfo[5];

            stats[groupName] = {
              pending,
              consumers,
              lastDelivered,
            };
          }
        }
      }
    } catch (error) {
      logger.error('Failed to get consumer stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return stats;
  }
}
