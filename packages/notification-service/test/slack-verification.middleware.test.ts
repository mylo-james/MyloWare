import { SlackVerificationMiddleware } from '../src/middleware/slack-verification.middleware';
import * as crypto from 'node:crypto';

describe('SlackVerificationMiddleware', () => {
  const secret = 'test_secret';
  const middleware = new SlackVerificationMiddleware();

  const sign = (ts: number, body: string) => {
    const base = `v0:${ts}:${body}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(base);
    return `v0=${hmac.digest('hex')}`;
  };

  const withEnv = (fn: () => void) => {
    const prev = process.env['SLACK_SIGNING_SECRET'];
    process.env['SLACK_SIGNING_SECRET'] = secret;
    try {
      fn();
    } finally {
      process.env['SLACK_SIGNING_SECRET'] = prev;
    }
  };

  it('accepts valid signatures', () => {
    withEnv(() => {
      const ts = Math.floor(Date.now() / 1000);
      const body = 'token=x&team_id=T&user_id=U&command=/mylo&text=status';
      const req: any = {
        headers: {
          'x-slack-request-timestamp': String(ts),
          'x-slack-signature': sign(ts, body),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: Object.fromEntries(new URLSearchParams(body).entries()),
        rawBody: body,
      };
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };
      new SlackVerificationMiddleware().use(req, {}, next);
      expect(nextCalled).toBe(true);
    });
  });

  it('rejects invalid signatures', () => {
    withEnv(() => {
      const ts = Math.floor(Date.now() / 1000);
      const body = 'a=1';
      const req: any = {
        headers: {
          'x-slack-request-timestamp': String(ts),
          'x-slack-signature': 'v0=deadbeef',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: Object.fromEntries(new URLSearchParams(body).entries()),
      };
      expect(() => new SlackVerificationMiddleware().use(req, {}, () => {})).toThrow();
    });
  });
});
