/**
 * Cleanup Scheduler Service
 *
 * Simplified background scheduler stub that can be triggered manually in tests
 * to evaluate cleanup decisions. Future iteration could use Bull/Redis.
 */

import { createLogger } from '@myloware/shared';
import type { ThreadManagerService } from './thread-manager.service';
import type { ChannelManagerService } from './channel-manager.service';

const logger = createLogger('notification-service:cleanup-scheduler');

export class CleanupSchedulerService {
  constructor(
    private readonly threadManager: ThreadManagerService,
    private readonly channelManager: ChannelManagerService
  ) {}

  async runCleanupSweep(): Promise<void> {
    // Placeholder for iterating thread contexts and applying retention rules.
    logger.info('Running cleanup sweep');
  }
}
