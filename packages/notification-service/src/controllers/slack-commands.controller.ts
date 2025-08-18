/**
 * Slack Commands Controller
 *
 * Exposes HTTP endpoints for Slack slash commands.
 */

import { Body, Controller, Post, Req, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { createLogger } from '@myloware/shared';
import { SlackCommandService, SlackSlashCommand } from '../services/slack-command.service';
import { ThreadManagerService } from '../services/thread-manager.service';

const logger = createLogger('notification-service:slack-commands');

@Controller('slack')
export class SlackCommandsController {
  private readonly commandService: SlackCommandService;

  constructor(private readonly threadManager: ThreadManagerService) {
    this.commandService = new SlackCommandService(threadManager);
  }

  @Post('commands')
  async handleSlashCommand(@Body() body: any, @Res() res: Response, @Req() _req: any) {
    // Slack expects 200 OK quickly with message body for ephemeral response
    try {
      const payload = body as SlackSlashCommand;
      const result = await this.commandService.handleSlashCommand(payload);
      return res.status(200).json({ response_type: 'ephemeral', text: result.text });
    } catch (error) {
      logger.error('Slash command failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'An error occurred while processing the command.',
      });
    }
  }
}
