/**
 * Slack Verification Middleware
 *
 * Implements Slack request signature verification for security.
 * Validates requests using HMAC-SHA256 with SLACK_SIGNING_SECRET.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '@myloware/shared';

const logger = createLogger('notification-service:slack-verification');

@Injectable()
export class SlackVerificationMiddleware implements NestMiddleware {
  private readonly signingSecret: string;
  private readonly maxTimestampAge = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor() {
    this.signingSecret = process.env['SLACK_SIGNING_SECRET'] || '';
    if (!this.signingSecret) {
      logger.warn('SLACK_SIGNING_SECRET not configured - signature verification disabled');
    }
  }

  /**
   * NestJS middleware implementation
   */
  use(req: Request, res: Response, next: NextFunction): void {
    // For now, just pass through - verification is handled in the controller
    // This middleware is here for future use if needed
    next();
  }

  /**
   * Verify Slack request signature
   */
  async verifySlackRequest(headers: Record<string, string>, body: string): Promise<boolean> {
    try {
      // Skip verification if signing secret not configured (simulation mode)
      if (!this.signingSecret) {
        logger.debug('Signature verification skipped - signing secret not configured');
        return true;
      }

      const timestamp = headers['x-slack-request-timestamp'];
      const signature = headers['x-slack-signature'];

      if (!timestamp || !signature) {
        logger.warn('Missing required Slack headers', {
          hasTimestamp: !!timestamp,
          hasSignature: !!signature,
        });
        return false;
      }

      // Check timestamp freshness (prevent replay attacks)
      const now = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp, 10);

      if (Math.abs(now - requestTime) > this.maxTimestampAge / 1000) {
        logger.warn('Slack request timestamp too old', {
          requestTime,
          currentTime: now,
          ageDiff: now - requestTime,
        });
        return false;
      }

      // Construct the basestring for signature verification
      const basestring = `v0:${timestamp}:${body}`;

      // Compute expected signature
      const expectedSignature = `v0=${createHmac('sha256', this.signingSecret)
        .update(basestring)
        .digest('hex')}`;

      // Use timing-safe comparison to prevent timing attacks
      const signatureBuffer = Buffer.from(signature, 'utf8');
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

      if (signatureBuffer.length !== expectedBuffer.length) {
        logger.warn('Slack signature length mismatch');
        return false;
      }

      const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

      if (!isValid) {
        logger.warn('Slack signature verification failed', {
          received: signature,
          expected: `${expectedSignature.substring(0, 20)}...`,
        });
      }

      return isValid;
    } catch (error) {
      logger.error('Slack signature verification error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get verification status for health checks
   */
  getVerificationStatus(): {
    isConfigured: boolean;
    signingSecretPresent: boolean;
  } {
    return {
      isConfigured: !!this.signingSecret,
      signingSecretPresent: !!this.signingSecret,
    };
  }
}
