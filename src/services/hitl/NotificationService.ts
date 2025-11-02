export interface NotifyParams {
  channels: string[];
  message: string;
  link: string;
  data?: unknown;
}

export class NotificationService {
  private slackWebhookUrl: string | null;
  private emailServiceApiKey: string | null;

  constructor() {
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || null;
    this.emailServiceApiKey = process.env.EMAIL_SERVICE_API_KEY || null;
  }

  async notify(params: NotifyParams): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const channel of params.channels) {
      switch (channel) {
        case 'slack':
          promises.push(this.notifySlack(params));
          break;
        case 'email':
          promises.push(this.notifyEmail(params));
          break;
        default:
          console.warn(`Unknown notification channel: ${channel}`);
      }
    }

    await Promise.allSettled(promises);
  }

  private async notifySlack(params: NotifyParams): Promise<void> {
    if (!this.slackWebhookUrl) {
      console.warn('SLACK_WEBHOOK_URL not configured, skipping Slack notification');
      return;
    }

    try {
      const response = await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: params.message,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: params.message,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `<${params.link}|Review and approve>`,
              },
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Slack notification failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to send Slack notification:', error);
      throw error;
    }
  }

  private async notifyEmail(params: NotifyParams): Promise<void> {
    if (!this.emailServiceApiKey) {
      console.warn('EMAIL_SERVICE_API_KEY not configured, skipping email notification');
      return;
    }

    // Placeholder for email service integration
    // In a real implementation, you would use SendGrid, AWS SES, etc.
    console.log('Email notification (not implemented):', {
      message: params.message,
      link: params.link,
    });
  }
}

