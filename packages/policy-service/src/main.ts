/**
 * Policy Service Main Entry Point
 *
 * Starts the Policy MCP service with human-in-the-loop decision management.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@myloware/shared';
import { PolicyModule } from './app.module';
import { PolicyService } from './services/policy.service';
import { McpServer } from './services/mcp-server.service';

const logger = createLogger('policy-service:main');

async function bootstrap() {
  try {
    logger.info('Starting MyloWare Policy Service');

    // Environment configuration
    const servicePort = parseInt(process.env['POLICY_SERVICE_PORT'] || '3005');
    const mcpPort = parseInt(process.env['POLICY_MCP_PORT'] || '8082');
    const mcpHost = process.env['MCP_HOST'] || 'localhost';

    // Create NestJS application for HTTP endpoints
    const app = await NestFactory.create(PolicyModule);

    // Configure CORS
    app.enableCors({
      origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
      credentials: true,
    });

    // Global prefix for API routes
    app.setGlobalPrefix('api/v1');

    // Initialize Policy Service
    const policyService = new PolicyService();
    await policyService.initialize();

    // Initialize MCP Server
    const mcpServer = new McpServer(mcpHost, mcpPort, policyService);
    await mcpServer.start();

    // Make services available globally
    app.get(PolicyModule).setServices(policyService, mcpServer);

    // Start HTTP server
    await app.listen(servicePort);
    logger.info('HTTP server started', { port: servicePort });

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down Policy Service');

      try {
        await mcpServer.stop();
        await policyService.stop();
        await app.close();
        logger.info('Policy Service shutdown completed');
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

    logger.info('Policy Service started successfully', {
      servicePort,
      mcpPort,
      mcpHost,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start Policy Service', { error: errorMessage });
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
