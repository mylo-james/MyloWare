import { SlackVerificationMiddleware } from '../src/middleware/slack-verification.middleware';
import * as crypto from 'node:crypto';

describe('SlackVerificationMiddleware', () => {
  const secret = 'test_secret';
  let middleware: SlackVerificationMiddleware;

  const sign = (ts: number, body: string): string => {
    const base = `v0:${ts}:${body}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(base);
    return `v0=${hmac.digest('hex')}`;
  };

  const withEnv = async (fn: () => Promise<void>): Promise<void> => {
    const prev = process.env['SLACK_SIGNING_SECRET'];
    process.env['SLACK_SIGNING_SECRET'] = secret;
    try {
      await fn();
    } finally {
      process.env['SLACK_SIGNING_SECRET'] = prev;
    }
  };

  beforeEach(() => {
    // Reset environment and create new middleware instance
    delete process.env['SLACK_SIGNING_SECRET'];
    middleware = new SlackVerificationMiddleware();
  });

  it('accepts valid signatures', async () => {
    await withEnv(async () => {
      middleware = new SlackVerificationMiddleware(); // Recreate with env var set
      const ts = Math.floor(Date.now() / 1000);
      const body = 'token=x&team_id=T&user_id=U&command=/mylo&text=status';
      const headers = {
        'x-slack-request-timestamp': String(ts),
        'x-slack-signature': sign(ts, body),
      };

      const result = await middleware.verifySlackRequest(headers, body);
      expect(result).toBe(true);
    });
  });

  it('rejects invalid signatures', async () => {
    await withEnv(async () => {
      middleware = new SlackVerificationMiddleware(); // Recreate with env var set
      const ts = Math.floor(Date.now() / 1000);
      const body = 'a=1';
      const headers = {
        'x-slack-request-timestamp': String(ts),
        'x-slack-signature': 'v0=deadbeef',
      };

      const result = await middleware.verifySlackRequest(headers, body);
      expect(result).toBe(false);
    });
  });

  it('skips verification when signing secret not configured', async () => {
    // No signing secret set
    const headers = {
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-slack-signature': 'v0=invalid',
    };

    const result = await middleware.verifySlackRequest(headers, 'test-body');
    expect(result).toBe(true); // Should return true in simulation mode
  });

  it('rejects old timestamps', async () => {
    await withEnv(async () => {
      middleware = new SlackVerificationMiddleware(); // Recreate with env var set
      const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const body = 'test-body';
      const headers = {
        'x-slack-request-timestamp': String(oldTs),
        'x-slack-signature': sign(oldTs, body),
      };

      const result = await middleware.verifySlackRequest(headers, body);
      expect(result).toBe(false);
    });
  });
});
