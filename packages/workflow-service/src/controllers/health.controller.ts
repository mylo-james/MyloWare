/**
 * Health Controller
 *
 * Provides health check endpoints for service monitoring.
 */

import { Controller, Get } from '@nestjs/common';
import { createLogger } from '@myloware/shared';
import { TemporalClientService } from '../services/temporal-client.service';

const logger = createLogger('workflow-service:health');

@Controller('health')
export class HealthController {
  constructor(private readonly temporalClient: TemporalClientService) {}

  /**
   * Basic health check endpoint
   */
  @Get()
  async healthCheck() {
    const timestamp = new Date().toISOString();

    return {
      status: 'healthy',
      service: 'workflow-service',
      timestamp,
      version: '1.0.0',
    };
  }

  /**
   * Detailed health check with dependencies
   */
  @Get('detailed')
  async detailedHealthCheck() {
    const timestamp = new Date().toISOString();

    try {
      // Check Temporal client status
      const temporalStatus = this.temporalClient.getHealthStatus();

      const health = {
        status: 'healthy',
        service: 'workflow-service',
        timestamp,
        version: '1.0.0',
        dependencies: {
          temporal: {
            status: temporalStatus.isConnected ? 'healthy' : 'unhealthy',
            namespace: temporalStatus.namespace,
            connected: temporalStatus.isConnected,
          },
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };

      // Determine overall health
      const isHealthy = temporalStatus.isConnected;
      health.status = isHealthy ? 'healthy' : 'unhealthy';

      if (!isHealthy) {
        logger.warn('Service health check failed', { health });
      }

      return health;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Health check failed', { error: errorMessage });

      return {
        status: 'unhealthy',
        service: 'workflow-service',
        timestamp,
        version: '1.0.0',
        error: errorMessage,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };
    }
  }

  /**
   * Readiness check for Kubernetes/container orchestration
   */
  @Get('ready')
  async readinessCheck() {
    try {
      const temporalStatus = this.temporalClient.getHealthStatus();

      if (!temporalStatus.isConnected) {
        throw new Error('Temporal client not connected');
      }

      return {
        status: 'ready',
        service: 'workflow-service',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Readiness check failed', { error: errorMessage });

      return {
        status: 'not-ready',
        service: 'workflow-service',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      };
    }
  }

  /**
   * Liveness check for Kubernetes/container orchestration
   */
  @Get('live')
  async livenessCheck() {
    return {
      status: 'alive',
      service: 'workflow-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
