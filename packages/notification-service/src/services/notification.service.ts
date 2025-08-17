/**
 * Notification Service
 *
 * Manages notifications, templates, and delivery tracking for the Notify MCP service.
 */

import { createLogger } from '@myloware/shared';
import type { SlackService } from './slack.service';

const logger = createLogger('notification-service:notification');

export interface NotificationTemplate {
  id: string;
  name: string;
  type: 'slack_message' | 'slack_modal' | 'email' | 'webhook';
  template: string;
  variables: string[];
  metadata?: Record<string, any>;
}

export interface NotificationRequest {
  templateId: string;
  recipient: string;
  variables: Record<string, any>;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  metadata?: Record<string, any>;
}

export interface NotificationDelivery {
  id: string;
  templateId: string;
  recipient: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  error?: string;
  retryCount: number;
  metadata?: Record<string, any>;
}

export class NotificationService {
  private templates: Map<string, NotificationTemplate> = new Map();
  private deliveries: Map<string, NotificationDelivery> = new Map();

  constructor(private readonly slackService: SlackService) {}

  /**
   * Initialize the notification service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Notification service');

      // Load default templates
      await this.loadDefaultTemplates();

      logger.info('Notification service initialized successfully', {
        templateCount: this.templates.size,
      });
    } catch (error) {
      logger.error('Failed to initialize Notification service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Send notification using template
   */
  async sendNotification(
    request: NotificationRequest
  ): Promise<{ success: boolean; deliveryId: string; error?: string }> {
    try {
      const template = this.templates.get(request.templateId);

      if (!template) {
        throw new Error(`Template not found: ${request.templateId}`);
      }

      const deliveryId = this.generateDeliveryId();

      const delivery: NotificationDelivery = {
        id: deliveryId,
        templateId: request.templateId,
        recipient: request.recipient,
        status: 'PENDING',
        retryCount: 0,
        ...(request.metadata && { metadata: request.metadata }),
      };

      this.deliveries.set(deliveryId, delivery);

      // Render template with variables
      const renderedContent = this.renderTemplate(template.template, request.variables);

      // Send notification based on template type
      let result: { success: boolean; error?: string };

      switch (template.type) {
        case 'slack_message':
          result = await this.slackService.sendMessage({
            channel: request.recipient,
            text: renderedContent,
          });
          break;

        case 'slack_modal':
          // For modals, we'd need a trigger_id, so this is a simplified implementation
          result = { success: false, error: 'Slack modal requires trigger_id' };
          break;

        default:
          result = { success: false, error: `Unsupported template type: ${template.type}` };
      }

      // Update delivery status
      if (result.success) {
        delivery.status = 'SENT';
        delivery.sentAt = new Date();
        logger.info('Notification sent successfully', {
          deliveryId,
          templateId: request.templateId,
          recipient: request.recipient,
        });
      } else {
        delivery.status = 'FAILED';
        delivery.failedAt = new Date();
        if (result.error) {
          delivery.error = result.error;
        }
        logger.error('Notification sending failed', {
          deliveryId,
          templateId: request.templateId,
          recipient: request.recipient,
          error: result.error,
        });
      }

      return {
        success: result.success,
        deliveryId,
        ...(result.error && { error: result.error }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send notification', {
        templateId: request.templateId,
        recipient: request.recipient,
        error: errorMessage,
      });
      return { success: false, deliveryId: '', error: errorMessage };
    }
  }

  /**
   * Get delivery status
   */
  async getDeliveryStatus(deliveryId: string): Promise<NotificationDelivery | null> {
    return this.deliveries.get(deliveryId) || null;
  }

  /**
   * Render template with variables
   */
  private renderTemplate(template: string, variables: Record<string, any>): string {
    let rendered = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replace(new RegExp(placeholder, 'g'), String(value));
    }

    return rendered;
  }

  /**
   * Load default notification templates
   */
  private async loadDefaultTemplates(): Promise<void> {
    const defaultTemplates: NotificationTemplate[] = [
      {
        id: 'work_order_created',
        name: 'Work Order Created',
        type: 'slack_message',
        template:
          '🆕 New work order created: {{workOrderId}}\nPriority: {{priority}}\nItems: {{itemCount}}',
        variables: ['workOrderId', 'priority', 'itemCount'],
      },
      {
        id: 'work_order_completed',
        name: 'Work Order Completed',
        type: 'slack_message',
        template: '✅ Work order completed: {{workOrderId}}\nProcessing time: {{processingTime}}ms',
        variables: ['workOrderId', 'processingTime'],
      },
      {
        id: 'approval_required',
        name: 'Approval Required',
        type: 'slack_message',
        template:
          '⚠️ Approval required for: {{policyName}}\nRequested by: {{requestedBy}}\nApproval ID: {{approvalId}}',
        variables: ['policyName', 'requestedBy', 'approvalId'],
      },
    ];

    for (const template of defaultTemplates) {
      this.templates.set(template.id, template);
    }

    logger.info('Default notification templates loaded', { count: defaultTemplates.length });
  }

  /**
   * Generate unique delivery ID
   */
  private generateDeliveryId(): string {
    return `delivery_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Stop the notification service
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Notification service');
      logger.info('Notification service stopped successfully');
    } catch (error) {
      logger.error('Error stopping Notification service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
