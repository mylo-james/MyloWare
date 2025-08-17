/**
 * Event Bus Controller
 *
 * HTTP API endpoints for event bus management and monitoring.
 */

import { Controller, Get, Post, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { createLogger } from '@myloware/shared';
import { EventPublisher } from '../publishers/event.publisher';
import { EventConsumerService } from '../consumers/event-consumer.service';
import { DeadLetterService } from '../services/dead-letter.service';
import type { MyloWareEvent, PublisherConfig } from '../types/events';
import { DEFAULT_EVENT_BUS_CONFIG } from '../types/events';

const logger = createLogger('event-bus-service:controller');

@Controller('event-bus')
export class EventBusController {
  private eventPublisher: EventPublisher;

  constructor() {
    // Initialize event publisher with default configuration
    const publisherConfig: PublisherConfig = {
      streamName: 'myloware:api_events',
      maxLength: 10000,
      batchSize: 10,
      flushInterval: 1000,
    };

    this.eventPublisher = new EventPublisher(publisherConfig, DEFAULT_EVENT_BUS_CONFIG.redisUrl);
  }

  /**
   * Publish a single event
   */
  @Post('publish')
  async publishEvent(@Body() event: MyloWareEvent): Promise<{
    success: boolean;
    eventId?: string;
    error?: string;
  }> {
    try {
      logger.info('Publishing event via API', {
        eventType: event.type,
        eventId: event.id,
      });

      const result = await this.eventPublisher.publishEvent(event);

      if (result.success) {
        logger.info('Event published successfully via API', {
          eventType: event.type,
          eventId: result.eventId,
        });
      } else {
        logger.error('Event publishing failed via API', {
          eventType: event.type,
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API event publishing error', {
        eventType: event.type,
        error: errorMessage,
      });

      throw new HttpException(
        { message: 'Failed to publish event', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Publish multiple events in batch
   */
  @Post('publish/batch')
  async publishEvents(@Body() events: MyloWareEvent[]): Promise<{
    success: boolean;
    published: number;
    failed: number;
    errors?: string[] | undefined;
  }> {
    // Type check: ensure events is an array
    if (!Array.isArray(events)) {
      throw new HttpException(
        { message: 'Request body must be an array of events' },
        HttpStatus.BAD_REQUEST
      );
    }
    // Optionally, check that each element is an object (not null)
    for (const event of events) {
      if (typeof event !== 'object' || event === null) {
        throw new HttpException(
          { message: 'Each event must be an object' },
          HttpStatus.BAD_REQUEST
        );
      }
    }
    try {
      logger.info('Publishing events batch via API', {
        eventCount: events.length,
      });

      const result = await this.eventPublisher.publishEvents(events);

      logger.info('Batch event publishing completed via API', {
        published: result.published,
        failed: result.failed,
        success: result.success,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API batch event publishing error', {
        eventCount: events.length,
        error: errorMessage,
      });

      throw new HttpException(
        { message: 'Failed to publish events batch', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get event bus statistics
   */
  @Get('stats')
  async getEventBusStats(): Promise<{
    publisher: any;
    consumer: any;
    deadLetter: any;
  }> {
    try {
      // Note: In a real implementation, these services would be injected
      // For now, we'll return basic stats
      const publisherStats = this.eventPublisher.getOutboxStats();
      const publisherHealth = this.eventPublisher.getHealthStatus();

      return {
        publisher: {
          ...publisherStats,
          ...publisherHealth,
        },
        consumer: {
          message: 'Consumer stats would be available when service is properly injected',
        },
        deadLetter: {
          message: 'Dead letter stats would be available when service is properly injected',
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get event bus stats', { error: errorMessage });

      throw new HttpException(
        { message: 'Failed to get event bus statistics', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Flush pending events from outbox
   */
  @Post('flush')
  async flushOutbox(): Promise<{
    published: number;
    failed: number;
    errors?: string[] | undefined;
  }> {
    try {
      logger.info('Manual outbox flush requested via API');

      const result = await this.eventPublisher.flushOutbox();

      logger.info('Manual outbox flush completed via API', {
        published: result.published,
        failed: result.failed,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API outbox flush error', { error: errorMessage });

      throw new HttpException(
        { message: 'Failed to flush outbox', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Reprocess dead letter queue entries
   */
  @Post('dead-letter/reprocess')
  async reprocessDeadLetterQueue(@Query('limit') limit?: string): Promise<{
    processed: number;
    failed: number;
    errors?: string[];
  }> {
    try {
      const reprocessLimit = limit ? parseInt(limit, 10) : 10;

      logger.info('Manual dead letter reprocessing requested via API', {
        limit: reprocessLimit,
      });

      // Note: In a real implementation, DeadLetterService would be injected
      // For now, return a placeholder response
      return {
        processed: 0,
        failed: 0,
        errors: ['Dead letter service not available - would be injected in full implementation'],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API dead letter reprocessing error', { error: errorMessage });

      throw new HttpException(
        { message: 'Failed to reprocess dead letter queue', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
