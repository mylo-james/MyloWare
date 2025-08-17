/**
 * Memory Service Main Entry Point
 *
 * Starts the Memory MCP service with knowledge management and vector search capabilities.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@myloware/shared';
import { MemoryModule } from './app.module';
import { McpServer } from './services/mcp-server.service';
import { MemoryService } from './services/memory.service';

const logger = createLogger('memory-service:main');

async function bootstrap() {
  try {
    logger.info('Starting MyloWare Memory Service');

    // Environment configuration
    const servicePort = parseInt(process.env['MEMORY_SERVICE_PORT'] || '3003');
    const mcpPort = parseInt(process.env['MCP_PORT'] || '8080');
    const mcpHost = process.env['MCP_HOST'] || 'localhost';

    // Create NestJS application for HTTP endpoints
    const app = await NestFactory.create(MemoryModule);

    // Configure CORS
    app.enableCors({
      origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
      credentials: true,
    });

    // Global prefix for API routes
    app.setGlobalPrefix('api/v1');

    // Initialize Memory Service
    const memoryService = new MemoryService();
    await memoryService.initialize();

    // Initialize MCP Server
    const mcpServer = new McpServer(mcpHost, mcpPort, memoryService);
    await mcpServer.start();

    // Make services available globally
    app.get(MemoryModule).setServices(memoryService, mcpServer);

    // Start HTTP server
    await app.listen(servicePort);
    logger.info('HTTP server started', { port: servicePort });

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down Memory Service');

      try {
        await mcpServer.stop();
        await memoryService.stop();
        await app.close();
        logger.info('Memory Service shutdown completed');
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

    logger.info('Memory Service started successfully', {
      servicePort,
      mcpPort,
      mcpHost,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start Memory Service', { error: errorMessage });
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
