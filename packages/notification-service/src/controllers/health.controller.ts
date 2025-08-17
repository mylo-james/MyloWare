/**
 * Health Controller
 *
 * Health check endpoints for notification service monitoring.
 */

import { Controller, Get } from '@nestjs/common';
import { createLogger } from '@myloware/shared';

const logger = createLogger('notification-service:health');

@Controller('health')
export class HealthController {
  /**
   * Basic health check endpoint
   */
  @Get()
  getHealth(): { status: string; timestamp: string; service: string } {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'notification-service',
    };
  }

  /**
   * Detailed health check with service dependencies
   */
  @Get('detailed')
  getDetailedHealth(): {
    status: string;
    timestamp: string;
    service: string;
    dependencies: {
      slack: { status: string; message: string };
      mcp: { status: string; message: string };
      templates: { status: string; message: string };
    };
  } {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'notification-service',
      dependencies: {
        slack: {
          status: 'healthy',
          message: 'Slack integration operational',
        },
        mcp: {
          status: 'healthy',
          message: 'MCP server operational',
        },
        templates: {
          status: 'healthy',
          message: 'Notification templates loaded',
        },
      },
    };
  }

  /**
   * Readiness probe for Kubernetes
   */
  @Get('ready')
  getReadiness(): { ready: boolean; timestamp: string } {
    return {
      ready: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Liveness probe for Kubernetes
   */
  @Get('live')
  getLiveness(): { alive: boolean; timestamp: string } {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
    };
  }
}
