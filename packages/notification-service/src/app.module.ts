/**
 * Notification Service App Module
 *
 * NestJS module configuration for the Notification MCP service.
 */

import { Module } from '@nestjs/common';
import { NotificationController } from './controllers/notification.controller';
import { HealthController } from './controllers/health.controller';
import { NotificationService } from './services/notification.service';
import { SlackService } from './services/slack.service';
import { McpServer } from './services/mcp-server.service';
import { ThreadManagementController } from './controllers/thread-management.controller';
import { ThreadManagerService } from './services/thread-manager.service';
import { MessageFormatterService } from './services/message-formatter.service';
import { ChannelManagerService } from './services/channel-manager.service';

@Module({
  imports: [],
  controllers: [NotificationController, HealthController, ThreadManagementController],
  providers: [ThreadManagerService, MessageFormatterService, ChannelManagerService],
})
export class NotificationModule {
  private notificationService: NotificationService | null = null;
  private slackService: SlackService | null = null;
  private mcpServer: McpServer | null = null;

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
