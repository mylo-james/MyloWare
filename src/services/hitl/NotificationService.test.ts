import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService } from './NotificationService';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    global.fetch = vi.fn();
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    process.env.EMAIL_SERVICE_API_KEY = 'test-key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.EMAIL_SERVICE_API_KEY;
  });

  describe('notify', () => {
    it('sends Slack notification with correct payload', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
      } as Response);

      service = new NotificationService();

      await service.notify({
        channels: ['slack'],
        message: 'Test message',
        link: '/hitl/review/123',
        data: { test: true },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining('Test message'),
        }),
      );
    });

    it('handles missing Slack webhook URL gracefully', async () => {
      delete process.env.SLACK_WEBHOOK_URL;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service = new NotificationService();

      await service.notify({
        channels: ['slack'],
        message: 'Test message',
        link: '/hitl/review/123',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('SLACK_WEBHOOK_URL not configured'),
      );
      expect(global.fetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('handles email notification placeholder', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      service = new NotificationService();

      await service.notify({
        channels: ['email'],
        message: 'Test message',
        link: '/hitl/review/123',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Email notification (not implemented):',
        expect.objectContaining({
          message: 'Test message',
          link: '/hitl/review/123',
        }),
      );

      consoleSpy.mockRestore();
    });

    it('sends to multiple channels', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
      } as Response);

      service = new NotificationService();

      await service.notify({
        channels: ['slack', 'email'],
        message: 'Test message',
        link: '/hitl/review/123',
      });

      expect(global.fetch).toHaveBeenCalledTimes(1); // Only Slack is implemented
    });

    it('handles unknown channels gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      service = new NotificationService();

      await service.notify({
        channels: ['unknown'],
        message: 'Test message',
        link: '/hitl/review/123',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown notification channel: unknown'),
      );

      consoleSpy.mockRestore();
    });
  });
});

