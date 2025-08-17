/**
 * Workflow Service App Module
 *
 * NestJS module configuration for the workflow service.
 * Provides HTTP endpoints for workflow management and monitoring.
 */

import { Module, Global } from '@nestjs/common';
import { WorkflowController } from './controllers/workflow.controller';
import { HealthController } from './controllers/health.controller';
import { TemporalClientService } from './services/temporal-client.service';

@Global()
@Module({
  controllers: [WorkflowController, HealthController],
  providers: [
    {
      provide: 'TEMPORAL_CLIENT',
      useFactory: () => {
        // This will be set by main.ts after client initialization
        return null;
      },
    },
  ],
  exports: ['TEMPORAL_CLIENT'],
})
export class AppModule {
  private temporalClient: TemporalClientService | null = null;

  setTemporalClient(client: TemporalClientService): void {
    this.temporalClient = client;
  }

  getTemporalClient(): TemporalClientService | null {
    return this.temporalClient;
  }
}
