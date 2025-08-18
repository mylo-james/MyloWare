import { ChannelManagerService } from '../src/services/channel-manager.service';

describe('ChannelManagerService', () => {
  test('returns default channel configs', () => {
    const svc = new ChannelManagerService();
    expect(svc.getChannel('feed').name).toBe('#mylo-feed');
    expect(svc.getChannel('approvals').name).toBe('#mylo-approvals');
    expect(svc.getChannel('control').name).toBe('#mylo-control');
  });
});
