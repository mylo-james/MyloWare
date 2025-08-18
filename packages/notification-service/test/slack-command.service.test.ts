import { SlackCommandService } from '../src/services/slack-command.service';

// Mock axios
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn().mockResolvedValue({ data: { workflowId: 'test-workflow-id' } }),
    get: jest.fn().mockResolvedValue({
      data: { status: 'RUNNING', progress: '50%', updatedAt: new Date().toISOString() },
    }),
    delete: jest.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

// Mock the singleton SlackService
jest.mock('../src/services/singletons', () => ({
  getSlackServiceInstance: (): unknown => ({
    sendMessage: jest.fn().mockResolvedValue({ success: true, ts: '123.456' }),
    sendEphemeralMessage: jest.fn().mockResolvedValue({ success: true }),
    openModal: jest.fn().mockResolvedValue({ success: true }),
    addReaction: jest.fn().mockResolvedValue({ success: true }),
    getHealthStatus: () => ({
      isInitialized: true,
      isSimulationMode: true,
      hasWebClient: false,
      isSocketModeActive: false,
    }),
    stop: jest.fn().mockResolvedValue(undefined),
  }),
}));

describe('SlackCommandService', () => {
  let svc: SlackCommandService;

  beforeEach(() => {
    svc = new SlackCommandService();
  });

  const mockPayload = {
    token: 'test-token',
    team_id: 'T123',
    team_domain: 'test-team',
    channel_id: 'C123',
    channel_name: 'test-channel',
    user_id: 'U123',
    user_name: 'testuser',
    command: '/mylo',
    text: '',
    response_url: 'https://hooks.slack.com/commands/123',
    trigger_id: 'trigger-123',
  };

  it('shows help on empty text', async () => {
    const res = await svc.processCommand({ ...mockPayload, text: '' });
    expect(res.text).toContain('MyloWare Commands');
  });

  it('processes new command', async () => {
    const res = await svc.processCommand({
      ...mockPayload,
      text: 'new docs-extract --title "Process"',
    });
    expect(res.text).toContain('Workflow started successfully');
  });

  it('validates status command usage', async () => {
    const res = await svc.processCommand({ ...mockPayload, text: 'status' });
    expect(res.text).toContain('Please provide a run ID');
  });
});
