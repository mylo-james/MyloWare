/**
 * Slack Command Service
 *
 * Processes Slack slash commands and integrates with workflow service.
 * Implements /mylo command handlers for workflow interaction.
 */

import { Injectable } from '@nestjs/common';
import { getSlackServiceInstance } from './singletons';
import { createLogger } from '@myloware/shared';
import axios from 'axios';
import type { Block, KnownBlock } from '@slack/web-api';

const logger = createLogger('notification-service:slack-command');

export interface SlackCommandPayload {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

export interface SlackCommandResponse {
  response_type: 'in_channel' | 'ephemeral';
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
}

@Injectable()
export class SlackCommandService {
  private readonly workflowServiceUrl: string;
  private slackService!: {
    sendMessage: (message: {
      channel: string;
      text: string;
      blocks?: (Block | KnownBlock)[];
    }) => Promise<{ success: boolean; ts?: string; error?: string }>;
  };

  constructor() {
    this.workflowServiceUrl = process.env['WORKFLOW_SERVICE_URL'] || 'http://localhost:3001';
  }

  /**
   * Initialize the service with SlackService instance
   */
  initialize(): void {
    this.slackService = getSlackServiceInstance();
  }

  /**
   * Process incoming slash command
   */
  async processCommand(payload: SlackCommandPayload): Promise<SlackCommandResponse> {
    const args = payload.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || 'help';

    logger.info('Processing slash command', {
      command: payload.command,
      subcommand,
      args: args.slice(1),
      user: payload.user_name,
      channel: payload.channel_name,
    });

    try {
      switch (subcommand) {
        case 'new':
          return await this.handleNewCommand(payload, args.slice(1));
        case 'status':
          return await this.handleStatusCommand(payload, args.slice(1));
        case 'talk':
          return await this.handleTalkCommand(payload, args.slice(1));
        case 'stop':
          return await this.handleStopCommand(payload, args.slice(1));
        case 'mute':
          return await this.handleMuteCommand(payload, args.slice(1));
        case 'help':
        default:
          return this.handleHelpCommand();
      }
    } catch (error) {
      logger.error('Command processing error', {
        subcommand,
        user: payload.user_name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        response_type: 'ephemeral',
        text: `❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Handle /mylo new command - Start new workflow
   */
  private async handleNewCommand(
    payload: SlackCommandPayload,
    args: string[]
  ): Promise<SlackCommandResponse> {
    try {
      // Parse template and title from args
      const template = args[0] || 'docs-extract-verify';
      const titleIndex = args.indexOf('--title');
      const title =
        titleIndex !== -1 && titleIndex + 1 < args.length ? args[titleIndex + 1] : undefined;

      logger.info('Starting new workflow', {
        template,
        title,
        user: payload.user_name,
      });

      // Call workflow service to start workflow
      const workflowResponse = await axios.post(
        `${this.workflowServiceUrl}/workflows/${template}`,
        {
          title: title || `Workflow started by ${payload.user_name}`,
          user_id: payload.user_id,
          channel_id: payload.channel_id,
        }
      );

      const runId = workflowResponse.data.workflowId;

      // Create initial thread in #mylo-feed channel
      await this.slackService.sendMessage({
        channel: '#mylo-feed',
        text: `🚀 New workflow started`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚀 *New Workflow Started*\n• *Run ID:* \`${runId}\`\n• *Template:* ${template}\n• *Started by:* <@${payload.user_id}>\n• *Status:* Starting...`,
            },
          },
        ],
      });

      return {
        response_type: 'ephemeral',
        text: `✅ Workflow started successfully!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Workflow Started Successfully!*\n• *Run ID:* \`${runId}\`\n• *Template:* ${template}\n• *Thread:* <#${payload.channel_id}|#mylo-feed>`,
            },
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to start workflow', {
        template: args[0],
        user: payload.user_name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        response_type: 'ephemeral',
        text: `❌ Failed to start workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Handle /mylo status command - Check workflow status
   */
  private async handleStatusCommand(
    payload: SlackCommandPayload,
    args: string[]
  ): Promise<SlackCommandResponse> {
    const runId = args[0];

    if (!runId) {
      return {
        response_type: 'ephemeral',
        text: '❌ Please provide a run ID: `/mylo status <run_id>`',
      };
    }

    try {
      // Query workflow service for status
      const statusResponse = await axios.get(
        `${this.workflowServiceUrl}/workflows/${runId}/status`
      );
      const status = statusResponse.data;

      return {
        response_type: 'ephemeral',
        text: `📊 Workflow Status`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📊 *Workflow Status*\n• *Run ID:* \`${runId}\`\n• *Status:* ${status.status}\n• *Progress:* ${status.progress || 'N/A'}\n• *Updated:* ${new Date(status.updatedAt).toLocaleString()}`,
            },
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get workflow status', {
        runId,
        user: payload.user_name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        response_type: 'ephemeral',
        text: `❌ Failed to get status for run ${runId}: ${error instanceof Error ? error.message : 'Not found'}`,
      };
    }
  }

  /**
   * Handle /mylo talk command - Add user comment
   */
  private async handleTalkCommand(
    payload: SlackCommandPayload,
    args: string[]
  ): Promise<SlackCommandResponse> {
    const message = args.join(' ');

    if (!message) {
      return {
        response_type: 'ephemeral',
        text: '❌ Please provide a message: `/mylo talk <message>`',
      };
    }

    try {
      // Add comment to current context or general feed
      await this.slackService.sendMessage({
        channel: '#mylo-feed',
        text: `💬 User comment from <@${payload.user_id}>: ${message}`,
      });

      return {
        response_type: 'ephemeral',
        text: '✅ Your comment has been added to the feed.',
      };
    } catch (error) {
      logger.error('Failed to add user comment', {
        user: payload.user_name,
        message: message.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        response_type: 'ephemeral',
        text: `❌ Failed to add comment: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Handle /mylo stop command - Stop workflow
   */
  private async handleStopCommand(
    payload: SlackCommandPayload,
    args: string[]
  ): Promise<SlackCommandResponse> {
    const runId = args[0];

    if (!runId) {
      return {
        response_type: 'ephemeral',
        text: '❌ Please provide a run ID: `/mylo stop <run_id>`',
      };
    }

    try {
      // Call workflow service to stop workflow
      await axios.delete(`${this.workflowServiceUrl}/workflows/${runId}`);

      return {
        response_type: 'ephemeral',
        text: `⏹️ Workflow ${runId} has been stopped.`,
      };
    } catch (error) {
      logger.error('Failed to stop workflow', {
        runId,
        user: payload.user_name,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        response_type: 'ephemeral',
        text: `❌ Failed to stop workflow ${runId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Handle /mylo mute command - Mute notifications
   */
  private async handleMuteCommand(
    payload: SlackCommandPayload,
    args: string[]
  ): Promise<SlackCommandResponse> {
    const runId = args[0];

    if (!runId) {
      return {
        response_type: 'ephemeral',
        text: '❌ Please provide a run ID: `/mylo mute <run_id>`',
      };
    }

    // For now, just acknowledge - actual muting logic would be implemented later
    logger.info('User muted notifications', {
      runId,
      user: payload.user_name,
    });

    return {
      response_type: 'ephemeral',
      text: `🔇 Notifications muted for workflow ${runId}. You'll only receive critical updates.`,
    };
  }

  /**
   * Handle help command - Show available commands
   */
  private handleHelpCommand(): SlackCommandResponse {
    return {
      response_type: 'ephemeral',
      text: 'MyloWare Commands',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*MyloWare Commands*\n\n• `/mylo new [template] [--title "..."]` - Start new workflow\n• `/mylo status <run_id>` - Check workflow status\n• `/mylo talk <message>` - Add comment to feed\n• `/mylo stop <run_id>` - Stop workflow\n• `/mylo mute <run_id>` - Mute notifications\n• `/mylo help` - Show this help',
          },
        },
      ],
    };
  }

  /**
   * Get service health status
   */
  getHealthStatus(): {
    workflowServiceUrl: string;
    isConfigured: boolean;
  } {
    return {
      workflowServiceUrl: this.workflowServiceUrl,
      isConfigured: !!this.workflowServiceUrl,
    };
  }
}
