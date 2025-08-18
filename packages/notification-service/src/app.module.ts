import { Module } from '@nestjs/common';
import { NotificationController } from './controllers/notification.controller';
import { HealthController } from './controllers/health.controller';
import { ThreadManagementController } from './controllers/thread-management.controller';
import { NotificationService } from './services/notification.service';
import { SlackService } from './services/slack.service';
import { McpServer } from './services/mcp-server.service';
import { MessageFormatterService } from './services/message-formatter.service';
import { ChannelManagerService } from './services/channel-manager.service';
import { ThreadManagerService } from './services/thread-manager.service';
import { SlackCommandsController } from './controllers/slack-commands.controller';
import { MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { SlackVerificationMiddleware } from './middleware/slack-verification.middleware';

@Module({
  imports: [],
  controllers: [
    NotificationController,
    HealthController,
    ThreadManagementController,
    SlackCommandsController,
  ],
  providers: [ThreadManagerService, MessageFormatterService, ChannelManagerService],
})
export class NotificationModule implements NestModule {
  private notificationService: NotificationService | null = null;
  private slackService: SlackService | null = null;
  private mcpServer: McpServer | null = null;

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SlackVerificationMiddleware)
      .forRoutes({ path: 'slack/commands', method: RequestMethod.POST });
  }

  setServices(
    notificationService: NotificationService,
    slackService: SlackService,
    mcpServer: McpServer
  ): void {
    this.notificationService = notificationService;
    this.slackService = slackService;
    this.mcpServer = mcpServer;
  }

  getNotificationService(): NotificationService | null {
    return this.notificationService;
  }

  getSlackService(): SlackService | null {
    return this.slackService;
  }

  getMcpServer(): McpServer | null {
    return this.mcpServer;
  }
}
