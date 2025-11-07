// Using built-in fetch (Node.js 18+)
import { withRetry, isRetryableError } from '../../utils/retry.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

export interface TelegramClientConfig {
  botToken: string;
}

export interface SendMessageResult {
  messageId: number;
  chatId: number;
  success: boolean;
}

export class TelegramClient {
  private readonly apiUrl: string;

  constructor(private config: TelegramClientConfig) {
    this.apiUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  /**
   * Send a message to a Telegram user
   * @param userId - Telegram user ID (extracted from sessionId, e.g., "123" from "telegram:123")
   * @param message - Message text to send
   * @returns Message result or null if sending fails (errors are logged, not thrown)
   */
  async sendMessage(userId: string, message: string): Promise<SendMessageResult | null> {
    if (!this.config.botToken || this.config.botToken === 'test-telegram-token') {
      logger.warn({
        msg: 'Telegram bot token not configured, skipping notification',
        userId,
      });
      return null;
    }

    const makeRequest = async (): Promise<SendMessageResult> => {
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: userId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Telegram API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as {
        ok: boolean;
        result?: { message_id: number; chat: { id: number } };
      };

      if (!data.ok || !data.result) {
        throw new Error('Telegram API returned unsuccessful response');
      }

      return {
        messageId: data.result.message_id,
        chatId: data.result.chat.id,
        success: true,
      };
    };

    try {
      return await withRetry(makeRequest, {
        maxRetries: 3,
        initialDelay: 1000,
        backoff: 'exponential',
        retryable: (error) => {
          // Retry on network errors and 5xx errors
          if (isRetryableError(error)) {
            return true;
          }
          // Also retry on 429 (rate limit)
          if (error instanceof Error && error.message.includes('429')) {
            return true;
          }
          return false;
        },
      });
    } catch (error) {
      // Log error but don't throw - notification failure shouldn't break handoff
      logger.warn({
        msg: 'Failed to send Telegram notification',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/**
 * Get Telegram client instance from config
 */
export function getTelegramClient(): TelegramClient | null {
  if (!config.telegram?.botToken) {
    return null;
  }
  return new TelegramClient({ botToken: config.telegram.botToken });
}

