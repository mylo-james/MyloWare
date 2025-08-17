/**
 * Notification Service Tests
 */

import { NotificationService } from '../src/services/notification.service';
import { SlackService } from '../src/services/slack.service';

describe('Notification Service', () => {
  let notificationService: NotificationService;
  let slackService: SlackService;

  beforeEach(() => {
    slackService = new SlackService();
    notificationService = new NotificationService(slackService);
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(notificationService.initialize()).resolves.not.toThrow();
    });
  });

  describe('SlackService', () => {
    it('should initialize in simulation mode without tokens', async () => {
      await expect(slackService.initialize()).resolves.not.toThrow();

      const health = slackService.getHealthStatus();
      expect(health.isSimulationMode).toBe(true);
      expect(health.isInitialized).toBe(true);
    });

    it('should send simulated messages', async () => {
      await slackService.initialize();

      const result = await slackService.sendMessage({
        channel: '#test',
        text: 'Test message',
      });

      expect(result.success).toBe(true);
      expect(result.ts).toMatch(/^sim_/);
    });

    it('should get simulated users', async () => {
      await slackService.initialize();

      const result = await slackService.getUsers();

      expect(result.success).toBe(true);
      expect(result.users).toBeDefined();
      expect(Array.isArray(result.users)).toBe(true);
      expect(result.users?.length).toBeGreaterThan(0);
    });
  });
});
