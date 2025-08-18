import { ThreadManagerService } from '../src/services/thread-manager.service';
import { MessageFormatterService } from '../src/services/message-formatter.service';
import { ChannelManagerService } from '../src/services/channel-manager.service';

class MockSlackService {
  messages: any[] = [];
  async sendMessage(msg: any) {
    this.messages.push(msg);
    return { success: true, ts: `ts_${this.messages.length}` };
  }
}

describe('Threading Integration', () => {
  test('end-to-end thread creation and updates', async () => {
    const slack = new MockSlackService() as any;
    const formatter = new MessageFormatterService();
    const channels = new ChannelManagerService();
    const feed = channels.getChannel('feed').name;
    const svc = new ThreadManagerService(formatter, { slackService: slack, feedChannelName: feed });

    const ctx = await svc.createRunThread('run_77', 'Workflow started');
    expect(ctx.channel).toBe(feed);
    await svc.updateRunThread('run_77', 'Halfway there', { status: 'IN_PROGRESS' });
    await svc.updateRunThread('run_77', 'All done', { status: 'DONE' });
    expect(slack.messages.length).toBe(3);
  });
});
