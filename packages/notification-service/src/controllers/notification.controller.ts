/**
 * Notification Controller
 *
 * HTTP API endpoints for notification management and Slack integration.
 */

import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { getSlackServiceInstance } from '../services/singletons';
import { createLogger } from '@myloware/shared';

const logger = createLogger('notification-service:controller');

@Controller('notifications')
export class NotificationController {
  /**
   * Send a notification
   */
  @Post('send')
  async sendNotification(
    @Body()
    body: {
      templateId: string;
      recipient: string;
      variables: Record<string, any>;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    }
  ): Promise<{ success: boolean; deliveryId: string; error?: string }> {
    try {
      logger.info('Sending notification via API', {
        templateId: body.templateId,
        recipient: body.recipient,
      });

      // Simulate notification sending
      const deliveryId = `delivery_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      logger.info('Notification sent successfully via API', { deliveryId });

      return { success: true, deliveryId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API notification sending error', { error: errorMessage });

      throw new HttpException(
        { message: 'Failed to send notification', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Send a test Slack message to a channel or user ID
   */
  @Post('slack/test')
  async sendSlackTest(
    @Body()
    body: {
      channel: string;
      text?: string;
    }
  ): Promise<{ success: boolean; ts?: string; error?: string }> {
    try {
      const slack = getSlackServiceInstance();
      const text = body.text || 'MyloWare Slack connectivity test ✅';
      const result = await slack.sendMessage({ channel: body.channel, text });
      if (!result.success) {
        throw new Error(result.error || 'Unknown Slack error');
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(
        { message: 'Failed to send Slack test message', error: errorMessage },
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Slack health status
   */
  @Get('slack/health')
  async getSlackHealth() {
    const slack = getSlackServiceInstance();
    const health = slack.getHealthStatus();
    return {
      success: true,
      slack: health,
    };
  }

  /**
   * Get delivery status
   */
  @Get('deliveries/:id')
  async getDeliveryStatus(@Param('id') deliveryId: string): Promise<any> {
    try {
      logger.info('Getting delivery status via API', { deliveryId });

      // Simulate delivery status
      const delivery = {
        id: deliveryId,
        status: 'SENT',
        sentAt: new Date().toISOString(),
        recipient: 'example@example.com',
      };

      return delivery;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API delivery status error', { deliveryId, error: errorMessage });

      throw new HttpException(
        { message: 'Failed to get delivery status', error: errorMessage },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
