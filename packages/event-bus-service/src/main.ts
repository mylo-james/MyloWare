/**
 * Event Bus Service Main Entry Point
 *
 * Starts the Redis Streams event bus service with publishers, consumers, and health monitoring.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@myloware/shared';
import { EventBusModule } from './app.module';
import { EventConsumerService } from './consumers/event-consumer.service';
import { EventPublisher } from './publishers/event.publisher';
import { DeadLetterService } from './services/dead-letter.service';
import { DEFAULT_EVENT_BUS_CONFIG } from './types/events';

const logger = createLogger('event-bus-service:main');

async function bootstrap() {
  try {
    logger.info('Starting MyloWare Event Bus Service');

    // Environment configuration
    const redisUrl = process.env['REDIS_URL'] || DEFAULT_EVENT_BUS_CONFIG.redisUrl;
    const servicePort = parseInt(process.env['EVENT_BUS_SERVICE_PORT'] || '3002');
    const consumerGroup = process.env['EVENT_BUS_CONSUMER_GROUP'] || 'myloware_consumers';

    // Create NestJS application for HTTP endpoints
    const app = await NestFactory.create(EventBusModule);

    // Configure CORS
    app.enableCors({
      origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
      credentials: true,
    });

    // Global prefix for API routes
    app.setGlobalPrefix('api/v1');

    // Initialize services
    const deadLetterService = new DeadLetterService(redisUrl);
    await deadLetterService.initialize();

    const eventConsumer = new EventConsumerService(redisUrl, consumerGroup);
    await eventConsumer.initialize();

    // Make services available globally
    app.get(EventBusModule).setServices(deadLetterService, eventConsumer);

    // Start HTTP server
    await app.listen(servicePort);
    logger.info('HTTP server started', { port: servicePort });

    // Start event consumers
    await eventConsumer.start();
    logger.info('Event consumers started');

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down Event Bus Service');

      try {
        await eventConsumer.stop();
        await deadLetterService.stop();
        await app.close();
        logger.info('Event Bus Service shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('Event Bus Service started successfully', {
      redisUrl,
      servicePort,
      consumerGroup,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start Event Bus Service', { error: errorMessage });
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});

bootstrap();
