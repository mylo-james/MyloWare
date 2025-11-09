import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('Session configuration via environment variables', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear session-related env to test defaults first
    delete process.env.SESSION_TTL_MS;
    delete process.env.MAX_SESSIONS_PER_USER;
  });

  afterEach(() => {
    // Restore env to original state
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses defaults when env vars are not set', async () => {
    const { SESSION_TTL_MS, MAX_SESSIONS } = await import('@/utils/constants.js');
    expect(SESSION_TTL_MS).toBe(3_600_000); // 1 hour default
    expect(MAX_SESSIONS).toBe(10); // default
  });

  it('reads SESSION_TTL_MS and MAX_SESSIONS_PER_USER from env', async () => {
    process.env.SESSION_TTL_MS = '1800000'; // 30 minutes
    process.env.MAX_SESSIONS_PER_USER = '5';
    vi.resetModules();

    const { SESSION_TTL_MS, MAX_SESSIONS } = await import('@/utils/constants.js');
    expect(SESSION_TTL_MS).toBe(1_800_000);
    expect(MAX_SESSIONS).toBe(5);
  });
});


