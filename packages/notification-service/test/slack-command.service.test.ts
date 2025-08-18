import { SlackCommandService } from '../src/services/slack-command.service';
import { ThreadManagerService } from '../src/services/thread-manager.service';
import { MessageFormatterService } from '../src/services/message-formatter.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({ data: { success: true } }),
    get: jest.fn().mockResolvedValue({ data: { status: 'RUNNING' } }),
    delete: jest.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

describe('SlackCommandService', () => {
  const threadManager = new ThreadManagerService(new MessageFormatterService(), {
    slackService: {
      // minimal SlackService shape used by ThreadManagerService
      sendMessage: async () => ({ success: true, ts: '123.456' }),
      sendEphemeralMessage: async () => ({ success: true }),
      openModal: async () => ({ success: true }),
      addReaction: async () => ({ success: true }),
      getHealthStatus: () => ({
        isInitialized: true,
        isSimulationMode: true,
        hasWebClient: false,
        isSocketModeActive: false,
      }),
      stop: async () => undefined,
    } as any,
    feedChannelName: '#test-feed',
  });

  const svc = new SlackCommandService(threadManager);

  it('shows help on empty text', async () => {
    const res = await svc.handleSlashCommand({
      command: '/mylo',
      text: '',
      user_id: 'U',
      user_name: 'alice',
      channel_id: 'C',
      channel_name: 'test',
    });
    expect(res.text).toContain('/mylo new');
  });

  it('parses flags for new command', async () => {
    const res = await svc.handleSlashCommand({
      command: '/mylo',
      text: 'new docs-extract --title "Process"',
      user_id: 'U',
      user_name: 'alice',
      channel_id: 'C',
      channel_name: 'test',
    });
    expect(res.text).toContain('Run created:');
  });

  it('validates status command usage', async () => {
    const res = await svc.handleSlashCommand({
      command: '/mylo',
      text: 'status',
      user_id: 'U',
      user_name: 'alice',
      channel_id: 'C',
      channel_name: 'test',
    });
    expect(res.text).toContain('Usage: /mylo status');
  });
});
