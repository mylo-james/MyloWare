import { SlackService } from '../src/services/slack.service';

describe('SlackService (simulation mode)', () => {
  it('initializes in simulation mode and supports messaging APIs', async () => {
    const svc = new SlackService();
    await svc.initialize();

    const msg = await svc.sendMessage({ channel: '#test', text: 'hello' });
    expect(msg.success).toBe(true);

    const eph = await svc.sendEphemeralMessage('#test', 'U001', 'temp');
    expect(eph.success).toBe(true);

    const modal = await svc.openModal({ trigger_id: 't1', view: { title: { text: 'T' } } });
    expect(modal.success).toBe(true);

    const react = await svc.addReaction({ channel: '#test', timestamp: '1.0', name: 'thumbsup' });
    expect(react.success).toBe(true);

    const users = await svc.getUsers();
    expect(users.success).toBe(true);

    const health = svc.getHealthStatus();
    expect(health.isInitialized).toBe(true);
    expect(health.isSimulationMode).toBe(true);

    await svc.stop();
  });
});
