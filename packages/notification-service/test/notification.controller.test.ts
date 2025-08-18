import { jest } from '@jest/globals';
import { NotificationService } from '../src/services/notification.service';
import { SlackService } from '../src/services/slack.service';

jest.mock('../src/services/slack.service', () => ({
  SlackService: class {
    initialize = jest.fn(async () => undefined);
    sendMessage = jest.fn(async () => ({ success: true, ts: 'sim_1' }));
    getUsers = jest.fn(async () => ({ success: true, users: [] }));
  },
}));

describe('NotificationService', () => {
  it('sends a message successfully via SlackService', async () => {
    const slack = new (SlackService as any)();
    const service = new NotificationService(slack);
    await service.initialize();
    const result = await service.sendNotification({
      templateId: 'work_order_created',
      recipient: '#test',
      variables: { workOrderId: 'WO1', priority: 'MEDIUM', itemCount: 0 },
      priority: 'MEDIUM',
    });
    expect(result.success).toBe(true);
  });
});
