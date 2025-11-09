import { describe, it, expect, afterEach, vi } from 'vitest';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';

import { config } from '@/config/index.js';
import { authenticateRequest } from '@/security/authentication.js';
import { logger } from '@/utils/logger.js';

const originalSecurity = {
  allowedCorsOrigins: [...config.security.allowedCorsOrigins],
  allowedHostKeys: [...config.security.allowedHostKeys],
  debugAuth: config.security.debugAuth,
};
const originalAuthKey = config.mcp.authKey;

afterEach(() => {
  config.security.allowedCorsOrigins = [...originalSecurity.allowedCorsOrigins];
  config.security.allowedHostKeys = [...originalSecurity.allowedHostKeys];
  config.security.debugAuth = originalSecurity.debugAuth;
  config.mcp.authKey = originalAuthKey;
});

describe('Security Controls', () => {
  it('rejects CORS requests when origin is not allowlisted', async () => {
    config.security.allowedCorsOrigins = ['http://allowed.test'];

    const app = Fastify();
    await app.register(cors, {
      origin: config.security.allowedCorsOrigins.length > 0 ? config.security.allowedCorsOrigins : false,
      credentials: true,
    });
    app.options('/mcp', (request, reply) => reply.code(204).send());

    const disallowed = await app.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: 'https://evil-site.com',
        'access-control-request-method': 'POST',
      },
    });

    expect(disallowed.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: 'http://allowed.test',
        'access-control-request-method': 'POST',
      },
    });

    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://allowed.test');

    await app.close();
  });

  it('omits auth hashes when DEBUG_AUTH=false', () => {
    config.security.debugAuth = false;
    config.mcp.authKey = 'expected-secret';

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as unknown as void);

    const request = {
      headers: { 'x-api-key': 'wrong-secret' },
      ip: '127.0.0.1',
      url: '/mcp',
      method: 'POST',
    } as unknown as FastifyRequest;

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply;

    const result = authenticateRequest(request, reply, 'test-request');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    const logPayload = warnSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(logPayload).not.toHaveProperty('providedKeyHash');
    expect(logPayload).not.toHaveProperty('expectedKeyHash');

    warnSpy.mockRestore();
  });

  it('includes auth hashes when DEBUG_AUTH=true', () => {
    config.security.debugAuth = true;
    config.mcp.authKey = 'expected-secret';

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as unknown as void);

    const request = {
      headers: { 'x-api-key': 'wrong-secret' },
      ip: '127.0.0.1',
      url: '/mcp',
      method: 'POST',
    } as unknown as FastifyRequest;

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as unknown as FastifyReply;

    const result = authenticateRequest(request, reply, 'test-request');

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalled();

    const logPayload = warnSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(logPayload).toHaveProperty('providedKeyHash');
    expect(logPayload).toHaveProperty('expectedKeyHash');

    warnSpy.mockRestore();
  });
});

