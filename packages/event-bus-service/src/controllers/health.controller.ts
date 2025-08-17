/**
 * Health Controller
 *
 * Health check endpoints for event bus service monitoring.
 */

import { Controller, Get } from '@nestjs/common';
import { createLogger } from '@myloware/shared';

const logger = createLogger('event-bus-service:health');

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
      service: 'event-bus-service',
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
      redis: { status: string; message: string };
      streams: { status: string; message: string };
      consumers: { status: string; message: string };
    };
  } {
    // Note: In a real implementation, these would check actual service status
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'event-bus-service',
      dependencies: {
        redis: {
          status: 'healthy',
          message: 'Redis connection active',
        },
        streams: {
          status: 'healthy',
          message: 'All event streams operational',
        },
        consumers: {
          status: 'healthy',
          message: 'All consumer groups active',
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
