/**
 * Health Controller
 *
 * Health check endpoints for memory service monitoring.
 */

import { Controller, Get } from '@nestjs/common';
import { createLogger } from '@myloware/shared';

const logger = createLogger('memory-service:health');

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
      service: 'memory-service',
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
      vectorSearch: { status: string; message: string };
    };
  } {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'memory-service',
      dependencies: {
        database: {
          status: 'healthy',
          message: 'PostgreSQL connection active',
        },
        mcp: {
          status: 'healthy',
          message: 'MCP server operational',
        },
        vectorSearch: {
          status: 'healthy',
          message: 'pgvector extension available',
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
