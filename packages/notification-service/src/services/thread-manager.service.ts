/**
 * Thread Manager Service
 *
 * Manages Slack thread lifecycle for workflow runs. Maintains an in-memory
 * mapping of run_id to Slack thread timestamp, with basic lifecycle controls.
 */

import { createLogger } from '@myloware/shared';
import type { SlackService } from './slack.service';
import { MessageFormatterService } from './message-formatter.service';
import { getSlackServiceInstance } from './singletons';

const logger = createLogger('notification-service:thread-manager');

export interface ThreadContext {
  run_id: string;
  channel: string;
  thread_ts: string;
  created_at: Date;
  last_updated: Date;
  status: 'active' | 'completed' | 'archived';
  message_count: number;
  participants: string[];
}

export class ThreadManagerService {
  private runIdToContext: Map<string, ThreadContext> = new Map();

  constructor(
    private readonly messageFormatter: MessageFormatterService,
    private readonly options?: { slackService?: SlackService; feedChannelName?: string }
  ) {}

  private getSlack(): SlackService {
    if (this.options?.slackService) return this.options.slackService;
    return getSlackServiceInstance();
  }

  private getFeedChannel(): string {
    return this.options?.feedChannelName || '#mylo-feed';
  }

  async createRunThread(
    runId: string,
    initialMessage: string,
    metadata?: Record<string, unknown>
  ): Promise<ThreadContext> {
    const existing = this.runIdToContext.get(runId);
    if (existing) {
      return existing;
    }

    const text = this.messageFormatter.formatInitialRunMessage(runId, initialMessage, metadata);
    const result = await this.getSlack().sendMessage({ channel: this.getFeedChannel(), text });
    if (!result.success || !result.ts) {
      throw new Error(result.error || 'Failed to create Slack thread');
    }

    const ctx: ThreadContext = {
      run_id: runId,
      channel: this.getFeedChannel(),
      thread_ts: result.ts,
      created_at: new Date(),
      last_updated: new Date(),
      status: 'active',
      message_count: 1,
      participants: [],
    };
    this.runIdToContext.set(runId, ctx);
    logger.info('Created run thread', { runId, ts: result.ts });
    return ctx;
  }

  async updateRunThread(
    runId: string,
    message: string,
    options?: {
      status?: 'STARTED' | 'IN_PROGRESS' | 'DONE' | 'ERROR';
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const ctx = this.runIdToContext.get(runId);
    if (!ctx) {
      // If context lost, create a new parent message and continue
      await this.createRunThread(
        runId,
        'Continuation: context restored for run',
        options?.metadata
      );
      return this.updateRunThread(runId, message, options);
    }

    const text = options?.status
      ? this.messageFormatter.formatRunUpdateMessage(
          runId,
          options.status,
          message,
          options?.metadata
        )
      : message;

    const result = await this.getSlack().sendMessage({
      channel: ctx.channel,
      text,
      thread_ts: ctx.thread_ts,
    });
    if (!result.success) {
      throw new Error(result.error || 'Failed to send Slack thread message');
    }

    ctx.last_updated = new Date();
    ctx.message_count += 1;
    if (options?.status === 'DONE' || options?.status === 'ERROR') {
      ctx.status = 'completed';
    }
  }

  async getThreadContext(runId: string): Promise<ThreadContext | null> {
    return this.runIdToContext.get(runId) || null;
  }

  async archiveThread(runId: string): Promise<void> {
    const ctx = this.runIdToContext.get(runId);
    if (!ctx) return;
    ctx.status = 'archived';
  }
}
