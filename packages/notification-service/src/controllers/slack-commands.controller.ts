/**
 * Slack Commands Controller
 *
 * HTTP endpoints for handling Slack slash commands.
 * Implements /mylo commands for workflow interaction.
 */

import { Controller, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { SlackCommandService } from '../services/slack-command.service';
import { SlackVerificationMiddleware } from '../middleware/slack-verification.middleware';
import { createLogger } from '@myloware/shared';

const logger = createLogger('notification-service:slack-commands');

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

@Controller('slack/commands')
export class SlackCommandsController {
  constructor(
    private readonly slackCommandService: SlackCommandService,
    private readonly slackVerification: SlackVerificationMiddleware
  ) {}

  /**
   * Handle /mylo slash command
   */
  @Post('mylo')
  async handleMyloCommand(
    @Body() payload: SlackCommandPayload,
    @Headers() headers: Record<string, string>
  ): Promise<{ response_type: string; text: string; blocks?: unknown[] }> {
    try {
      // Verify Slack request signature
      const isValid = await this.slackVerification.verifySlackRequest(
        headers,
        JSON.stringify(payload)
      );

      if (!isValid) {
        logger.warn('Invalid Slack signature detected', {
          user_id: payload.user_id,
          command: payload.command,
        });
        throw new HttpException('Invalid request signature', HttpStatus.UNAUTHORIZED);
      }

      logger.info('Processing Slack command', {
        command: payload.command,
        text: payload.text,
        user_id: payload.user_id,
        channel_id: payload.channel_id,
      });

      // Parse command and delegate to service
      const result = await this.slackCommandService.processCommand(payload);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Slack command processing error', {
        command: payload.command,
        text: payload.text,
        user_id: payload.user_id,
        error: errorMessage,
      });

      // Return ephemeral error response to user
      if (error instanceof HttpException) {
        throw error;
      }

      return {
        response_type: 'ephemeral',
        text: `❌ Command failed: ${errorMessage}`,
      };
    }
  }
}
