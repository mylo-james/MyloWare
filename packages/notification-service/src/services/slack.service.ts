/**
 * Slack Service
 *
 * Integrates with Slack API for notifications, messages, and user interactions.
 * Implements all required Slack API endpoints for the Notify MCP service.
 */

import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { createLogger } from '@myloware/shared';

const logger = createLogger('notification-service:slack');

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
  thread_ts?: string;
}

export interface SlackModal {
  trigger_id: string;
  view: unknown;
}

export interface SlackReaction {
  channel: string;
  timestamp: string;
  name: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  email?: string;
  is_bot: boolean;
}

export class SlackService {
  private app: App | null = null;
  private webClient: WebClient | null = null;
  private isInitialized = false;
  private isSimulationMode = false;
  private isSocketModeActive = false;

  constructor(
    private readonly botToken?: string,
    private readonly signingSecret?: string,
    private readonly appToken?: string
  ) {
    this.isSimulationMode = !botToken || !signingSecret;
  }

  /**
   * Initialize Slack service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Slack service', {
        simulationMode: this.isSimulationMode,
      });

      if (this.isSimulationMode) {
        logger.warn('Running in simulation mode - Slack tokens not configured');
        this.isInitialized = true;
        return;
      }

      // Initialize Slack App
      if (!this.botToken || !this.signingSecret) {
        throw new Error('Slack bot token and signing secret are required');
      }

      this.app = new App({
        token: this.botToken,
        signingSecret: this.signingSecret,
        ...(this.appToken && { appToken: this.appToken }),
        socketMode: !!this.appToken,
      });

      // Initialize Web Client
      this.webClient = new WebClient(this.botToken);

      // Test connection
      const authResult = await this.webClient.auth.test();

      if (!authResult.ok) {
        throw new Error(`Slack authentication failed: ${authResult.error}`);
      }

      logger.info('Slack service initialized successfully', {
        botId: authResult.bot_id,
        teamId: authResult.team_id,
        userId: authResult.user_id,
      });

      // Start Socket Mode if configured
      if (this.app && this.appToken) {
        await this.app.start();
        this.isSocketModeActive = true;
        logger.info('Slack Socket Mode started');
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize Slack service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send message to Slack channel or user
   */
  async sendMessage(
    message: SlackMessage
  ): Promise<{ success: boolean; ts?: string; error?: string }> {
    try {
      if (this.isSimulationMode) {
        logger.info('Simulating Slack message', {
          channel: message.channel,
          text: message.text.substring(0, 100),
        });
        return { success: true, ts: `sim_${Date.now()}` };
      }

      if (!this.webClient) {
        throw new Error('Slack service not initialized');
      }

      const result = await this.webClient.chat.postMessage({
        channel: message.channel,
        text: message.text,
        ...(message.blocks && { blocks: message.blocks }),
        ...(message.attachments && { attachments: message.attachments }),
        ...(message.thread_ts && { thread_ts: message.thread_ts }),
      });

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      logger.info('Slack message sent successfully', {
        channel: message.channel,
        ts: result.ts,
      });

      return {
        success: true,
        ...(result.ts && { ts: result.ts }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send Slack message', {
        channel: message.channel,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send ephemeral message (temporary message visible only to specific user)
   */
  async sendEphemeralMessage(
    channel: string,
    user: string,
    text: string,
    blocks?: unknown[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.isSimulationMode) {
        logger.info('Simulating Slack ephemeral message', {
          channel,
          user,
          text: text.substring(0, 100),
        });
        return { success: true };
      }

      if (!this.webClient) {
        throw new Error('Slack service not initialized');
      }

      const result = await this.webClient.chat.postEphemeral({
        channel,
        user,
        text,
        blocks,
      });

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      logger.info('Slack ephemeral message sent successfully', {
        channel,
        user,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send Slack ephemeral message', {
        channel,
        user,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Open modal dialog
   */
  async openModal(modal: SlackModal): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.isSimulationMode) {
        logger.info('Simulating Slack modal', {
          trigger_id: modal.trigger_id,
          title: modal.view?.title?.text || 'Unknown',
        });
        return { success: true };
      }

      if (!this.webClient) {
        throw new Error('Slack service not initialized');
      }

      const result = await this.webClient.views.open({
        trigger_id: modal.trigger_id,
        view: modal.view,
      });

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      logger.info('Slack modal opened successfully', {
        trigger_id: modal.trigger_id,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to open Slack modal', {
        trigger_id: modal.trigger_id,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Add reaction to message
   */
  async addReaction(reaction: SlackReaction): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.isSimulationMode) {
        logger.info('Simulating Slack reaction', {
          channel: reaction.channel,
          timestamp: reaction.timestamp,
          name: reaction.name,
        });
        return { success: true };
      }

      if (!this.webClient) {
        throw new Error('Slack service not initialized');
      }

      const result = await this.webClient.reactions.add({
        channel: reaction.channel,
        timestamp: reaction.timestamp,
        name: reaction.name,
      });

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      logger.info('Slack reaction added successfully', {
        channel: reaction.channel,
        name: reaction.name,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to add Slack reaction', {
        channel: reaction.channel,
        name: reaction.name,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get list of users
   */
  async getUsers(): Promise<{ success: boolean; users?: SlackUser[]; error?: string }> {
    try {
      if (this.isSimulationMode) {
        const simulatedUsers: SlackUser[] = [
          {
            id: 'U001',
            name: 'alice',
            real_name: 'Alice Johnson',
            email: 'alice@example.com',
            is_bot: false,
          },
          {
            id: 'U002',
            name: 'bob',
            real_name: 'Bob Smith',
            email: 'bob@example.com',
            is_bot: false,
          },
          { id: 'B001', name: 'myloware-bot', real_name: 'MyloWare Bot', is_bot: true },
        ];

        logger.info('Simulating Slack users list', { count: simulatedUsers.length });
        return { success: true, users: simulatedUsers };
      }

      if (!this.webClient) {
        throw new Error('Slack service not initialized');
      }

      const result = await this.webClient.users.list({});

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error}`);
      }

      const users: SlackUser[] = (result.members || []).map(
        (member: {
          id: string;
          name: string;
          real_name: string;
          profile?: { email?: string };
          is_bot: boolean;
        }) => ({
          id: member.id,
          name: member.name,
          real_name: member.real_name,
          email: member.profile?.email,
          is_bot: member.is_bot,
        })
      );

      logger.info('Slack users retrieved successfully', { count: users.length });

      return { success: true, users };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get Slack users', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus(): {
    isInitialized: boolean;
    isSimulationMode: boolean;
    hasWebClient: boolean;
    isSocketModeActive: boolean;
  } {
    return {
      isInitialized: this.isInitialized,
      isSimulationMode: this.isSimulationMode,
      hasWebClient: !!this.webClient,
      isSocketModeActive: this.isSocketModeActive,
    };
  }

  /**
   * Stop the Slack service
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Slack service');

      if (this.app) {
        await this.app.stop();
        this.isSocketModeActive = false;
        this.app = null;
      }

      this.webClient = null;
      this.isInitialized = false;

      logger.info('Slack service stopped successfully');
    } catch (error) {
      logger.error('Error stopping Slack service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
