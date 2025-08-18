/**
 * Notification Service Main Entry Point
 *
 * Starts the Notify MCP service with Slack integration and notification management.
 */

import 'reflect-metadata';
import * as path from 'node:path';
import * as fs from 'node:fs';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@myloware/shared';
import { NotificationModule } from './app.module';
import { SlackService } from './services/slack.service';
import { NotificationService } from './services/notification.service';
import { McpServer } from './services/mcp-server.service';
import { setSlackServiceInstance } from './services/singletons';

const logger = createLogger('notification-service:main');

async function bootstrap() {
  try {
    logger.info('Starting MyloWare Notification Service');

    // Load environment from common locations (dev)
    const repoRoot = path.resolve(__dirname, '../../..');
    const packageRoot = path.resolve(__dirname, '..');
    const candidateEnvPaths = [
      path.join(repoRoot, '.env'),
      path.join(repoRoot, '.env.local'),
      path.join(packageRoot, '.env'),
      path.join(packageRoot, '.env.local'),
      path.join(process.cwd(), '.env'),
      path.join(process.cwd(), '.env.local'),
    ];
    const loadedEnvPaths: string[] = [];
    for (const p of candidateEnvPaths) {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p });
        loadedEnvPaths.push(p);
      }
    }
    if (loadedEnvPaths.length > 0) {
      logger.info('Loaded environment variables from', { paths: loadedEnvPaths });
      process.env['ENV_LOADED_PATHS'] = loadedEnvPaths.join(',');
    } else {
      logger.warn('No .env files found in common locations', { candidateEnvPaths });
      process.env['ENV_LOADED_PATHS'] = '';
    }

    // Environment configuration
    const servicePort = parseInt(process.env['NOTIFICATION_SERVICE_PORT'] || '3004');
    const mcpPort = parseInt(process.env['NOTIFY_MCP_PORT'] || '8081');
    const mcpHost = process.env['MCP_HOST'] || 'localhost';

    // Slack configuration
    const slackBotToken = process.env['SLACK_BOT_TOKEN'];
    const slackSigningSecret = process.env['SLACK_SIGNING_SECRET'];
    const slackAppToken = process.env['SLACK_APP_TOKEN'];

    if (!slackBotToken || !slackSigningSecret) {
      logger.warn('Slack tokens not configured - running in simulation mode');
    }

    // Create NestJS application for HTTP endpoints
    const app = await NestFactory.create(NotificationModule);

    // Configure CORS
    app.enableCors({
      origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000',
      credentials: true,
    });

    // Global prefix for API routes
    app.setGlobalPrefix('api/v1');

    // Initialize Slack Service
    const slackService = new SlackService(slackBotToken, slackSigningSecret, slackAppToken);
    await slackService.initialize();

    // Expose SlackService instance for controllers
    setSlackServiceInstance(slackService);

    // Initialize Notification Service
    const notificationService = new NotificationService(slackService);
    await notificationService.initialize();

    // Initialize MCP Server
    const mcpServer = new McpServer(mcpHost, mcpPort, notificationService);
    await mcpServer.start();

    // Make services available globally
    app.get(NotificationModule).setServices(notificationService, slackService, mcpServer);

    // Start HTTP server
    await app.listen(servicePort);
    logger.info('HTTP server started', { port: servicePort });

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down Notification Service');

      try {
        await mcpServer.stop();
        await notificationService.stop();
        await slackService.stop();
        await app.close();
        logger.info('Notification Service shutdown completed');
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

    logger.info('Notification Service started successfully', {
      servicePort,
      mcpPort,
      mcpHost,
      slackConfigured: !!slackBotToken,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to start Notification Service', { error: errorMessage });
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
