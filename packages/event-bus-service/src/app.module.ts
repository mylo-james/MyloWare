/**
 * Event Bus Service App Module
 *
 * NestJS module configuration for the Redis Streams event bus service.
 */

import { Module } from '@nestjs/common';
import { EventBusController } from './controllers/event-bus.controller';
import { HealthController } from './controllers/health.controller';
import { EventConsumerService } from './consumers/event-consumer.service';
import { DeadLetterService } from './services/dead-letter.service';

@Module({
  imports: [],
  controllers: [EventBusController, HealthController],
  providers: [],
})
export class EventBusModule {
  private deadLetterService: DeadLetterService | null = null;
  private eventConsumer: EventConsumerService | null = null;

  setServices(deadLetterService: DeadLetterService, eventConsumer: EventConsumerService): void {
    this.deadLetterService = deadLetterService;
    this.eventConsumer = eventConsumer;
  }

  getDeadLetterService(): DeadLetterService | null {
    return this.deadLetterService;
  }

  getEventConsumer(): EventConsumerService | null {
    return this.eventConsumer;
  }
}
