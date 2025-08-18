/**
 * Slack Verification Middleware
 *
 * Verifies Slack request signatures using SLACK_SIGNING_SECRET.
 * Rejects requests older than 5 minutes or with invalid signatures.
 */

import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { createLogger } from '@myloware/shared';

const logger = createLogger('notification-service:slack-verification');

@Injectable()
export class SlackVerificationMiddleware implements NestMiddleware {
  private readonly signingSecret: string | undefined;

  constructor() {
    this.signingSecret = process.env['SLACK_SIGNING_SECRET'];
  }

  use(req: any, _res: any, next: () => void): void {
    if (!this.signingSecret) {
      logger.warn('SLACK_SIGNING_SECRET is not set; rejecting request');
      throw new BadRequestException('Invalid Slack signature');
    }

    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];

    if (!timestamp || !signature) {
      throw new BadRequestException('Missing Slack signature headers');
    }

    const now = Math.floor(Date.now() / 1000);
    const tsNum = parseInt(String(timestamp), 10);
    if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 60 * 5) {
      throw new BadRequestException('Stale Slack request');
    }

    // Prefer rawBody if present (set by body parsers with verify hook). Fallback best-effort.
    let rawBodyString: string | undefined;
    if (req.rawBody) {
      rawBodyString = Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString('utf8')
        : String(req.rawBody);
    }
    if (!rawBodyString) {
      // Attempt to reconstruct body
      const contentType = req.headers['content-type'] || '';
      if (
        contentType.includes('application/x-www-form-urlencoded') &&
        req.body &&
        typeof req.body === 'object'
      ) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(req.body)) params.set(k, String(v));
        rawBodyString = params.toString();
      } else {
        rawBodyString = JSON.stringify(req.body || {});
      }
    }

    const baseString = `v0:${tsNum}:${rawBodyString}`;
    const hmac = crypto.createHmac('sha256', this.signingSecret);
    hmac.update(baseString);
    const computed = `v0=${hmac.digest('hex')}`;

    const provided = Buffer.from(String(signature), 'utf8');
    const expected = Buffer.from(computed, 'utf8');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw new BadRequestException('Invalid Slack signature');
    }

    next();
  }
}
