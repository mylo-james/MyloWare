/**
 * Channel Manager Service
 *
 * Centralizes channel names and basic permission checks. In a future
 * iteration, this would query Slack for channel metadata and permissions.
 */

export type ChannelPurpose = 'feed' | 'approvals' | 'control';

export interface ChannelConfig {
  name: string;
  purpose: ChannelPurpose;
  auto_archive_hours?: number;
  cleanup_policy: 'archive' | 'delete' | 'retain';
}

export class ChannelManagerService {
  private readonly channels: Record<ChannelPurpose, ChannelConfig>;

  constructor(customConfig?: Partial<Record<ChannelPurpose, ChannelConfig>>) {
    this.channels = {
      feed: {
        name: '#mylo-feed',
        purpose: 'feed',
        auto_archive_hours: 24 * 7,
        cleanup_policy: 'archive',
      },
      approvals: {
        name: '#mylo-approvals',
        purpose: 'approvals',
        auto_archive_hours: 24 * 30,
        cleanup_policy: 'archive',
      },
      control: { name: '#mylo-control', purpose: 'control', cleanup_policy: 'retain' },
      ...(customConfig || {}),
    } as Record<ChannelPurpose, ChannelConfig>;
  }

  getChannel(purpose: ChannelPurpose): ChannelConfig {
    return this.channels[purpose];
  }
}
