export interface NotifyParams {
  channels: string[];
  message: string;
  link: string;
  data?: unknown;
  telegramChatId?: string;
}

export class NotificationService {
  private slackWebhookUrl: string | null;
  private emailServiceApiKey: string | null;
  private telegramBotToken: string | null;

  constructor() {
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || null;
    this.emailServiceApiKey = process.env.EMAIL_SERVICE_API_KEY || null;
    this.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || null;
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
        case 'telegram':
          promises.push(this.notifyTelegram(params));
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

  private async notifyTelegram(params: NotifyParams): Promise<void> {
    if (!this.telegramBotToken) {
      console.warn('TELEGRAM_BOT_TOKEN not configured, skipping Telegram notification');
      return;
    }

    if (!params.telegramChatId) {
      console.warn('telegramChatId not provided, skipping Telegram notification');
      return;
    }

    try {
      const message = `${params.message}\n\nPlease reply with your decision to approve or reject this request.`;

      const response = await fetch(
        `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: params.telegramChatId,
            text: message,
            parse_mode: 'Markdown',
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram notification failed: ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to send Telegram notification:', error);
      throw error;
    }
  }
}

