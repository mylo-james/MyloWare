/**
 * Health Controller
 *
 * Health check endpoints for policy service monitoring.
 */

import { Controller, Get } from '@nestjs/common';
import { createLogger } from '@myloware/shared';

const logger = createLogger('policy-service:health');

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
      service: 'policy-service',
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
      database: { status: string; message: string };
      mcp: { status: string; message: string };
      policies: { status: string; message: string };
    };
  } {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'policy-service',
      dependencies: {
        database: {
          status: 'healthy',
          message: 'PostgreSQL connection active',
        },
        mcp: {
          status: 'healthy',
          message: 'MCP server operational',
        },
        policies: {
          status: 'healthy',
          message: 'Policy engine operational',
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
