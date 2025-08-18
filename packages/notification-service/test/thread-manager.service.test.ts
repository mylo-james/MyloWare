import { ThreadManagerService } from '../src/services/thread-manager.service';
import { MessageFormatterService } from '../src/services/message-formatter.service';

class MockSlackService {
  messages: any[] = [];
  async sendMessage(msg: any) {
    this.messages.push(msg);
    return { success: true, ts: `ts_${this.messages.length}` };
  }
}

describe('ThreadManagerService', () => {
  test('creates a new thread and posts initial message', async () => {
    const slack = new MockSlackService() as any;
    const formatter = new MessageFormatterService();
    const svc = new ThreadManagerService(formatter, {
      slackService: slack,
      feedChannelName: '#mylo-feed',
    });
    const ctx = await svc.createRunThread('run_1', 'Initial');
    expect(ctx.thread_ts).toBeTruthy();
    expect(ctx.run_id).toBe('run_1');
    expect(slack.messages[0].channel).toBe('#mylo-feed');
  });

  test('updates an existing thread', async () => {
    const slack = new MockSlackService() as any;
    const formatter = new MessageFormatterService();
    const svc = new ThreadManagerService(formatter, {
      slackService: slack,
      feedChannelName: '#mylo-feed',
    });
    await svc.createRunThread('run_2', 'Initial');
    await svc.updateRunThread('run_2', 'Progress update', { status: 'IN_PROGRESS' });
    expect(slack.messages.length).toBe(2);
    expect(slack.messages[1].thread_ts).toBeDefined();
  });
});
