/**
 * Workflow Service Main Entry Point
 *
 * Starts the Temporal worker service and sets up monitoring endpoints.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@myloware/shared';
import { TemporalWorkerService } from './services/temporal-worker.service';
import { TemporalClientService } from './services/temporal-client.service';
import { AppModule } from './app.module';

const logger = createLogger('workflow-service:main');

async function bootstrap() {
  try {
    logger.info('Starting MyloWare Workflow Service');

    // Environment configuration
    const temporalHost = process.env['TEMPORAL_HOST'] || 'localhost';
    const temporalPort = parseInt(process.env['TEMPORAL_PORT'] || '7233');
    const namespace = process.env['TEMPORAL_NAMESPACE'] || 'default';
    const taskQueue = process.env['TEMPORAL_TASK_QUEUE'] || 'myloware-tasks';
    const servicePort = parseInt(process.env['WORKFLOW_SERVICE_PORT'] || '3001');

    // Initialize Temporal client
    const temporalClient = new TemporalClientService(temporalHost, temporalPort, namespace);
    await temporalClient.initialize();

    // Create NestJS application for HTTP endpoints
    const app = await NestFactory.create(AppModule);

    // Configure CORS
    app.enableCors({
      origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
      credentials: true,
    });

    // Global prefix for API routes
    app.setGlobalPrefix('api/v1');

    // Make services available globally
    app.get(AppModule).setTemporalClient(temporalClient);

    // Start HTTP server
    await app.listen(servicePort);
    logger.info('HTTP server started', { port: servicePort });

    // Start Temporal worker
    const temporalWorker = new TemporalWorkerService(
      temporalHost,
      temporalPort,
      namespace,
      taskQueue
    );

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down Workflow Service');

      try {
        await temporalWorker.stop();
        await temporalClient.close();
        await app.close();
        logger.info('Workflow Service shutdown completed');
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

    // Start worker (this will block)
    logger.info('Starting Temporal worker', {
      host: temporalHost,
      port: temporalPort,
      namespace,
      taskQueue,
    });

    await temporalWorker.start();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start Workflow Service', { error: errorMessage });
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
