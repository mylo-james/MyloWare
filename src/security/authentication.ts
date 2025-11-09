import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

import { config } from '@/config/index.js';
import { logger } from '@/utils/logger.js';

const hashValue = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const authenticateRequest = (
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
): request is FastifyRequest => {
  if (!config.mcp.authKey) {
    return true;
  }

  const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
  const providedKey = apiKeyHeader?.trim() || '';

  try {
    const expectedKeyBuffer = Buffer.from(config.mcp.authKey, 'utf8');
    const providedKeyBuffer = Buffer.from(providedKey, 'utf8');

    if (expectedKeyBuffer.length !== providedKeyBuffer.length) {
      const dummyBuffer = Buffer.alloc(expectedKeyBuffer.length);
      timingSafeEqual(expectedKeyBuffer, dummyBuffer);
      return false;
    }

    if (timingSafeEqual(expectedKeyBuffer, providedKeyBuffer)) {
      return true;
    }
  } catch {
    return false;
  }

  const debugAuth = config.security.debugAuth;

  if (debugAuth) {
    logger.warn({
      msg: 'Unauthorized MCP access attempt (DEBUG MODE)',
      requestId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      url: request.url,
      method: request.method,
      headerKeys: Object.keys(request.headers ?? {}),
      providedKeyLength: providedKey?.length ?? 0,
      expectedKeyLength: config.mcp.authKey?.length ?? 0,
      providedKeyHash: providedKey ? hashValue(providedKey) : null,
      expectedKeyHash: config.mcp.authKey ? hashValue(config.mcp.authKey) : null,
    });
  } else {
    logger.warn({
      msg: 'Unauthorized MCP access attempt',
      requestId,
      ip: request.ip,
      url: request.url,
      method: request.method,
    });
  }

  reply.code(401).send({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message: 'Unauthorized',
    },
    id: null,
  });
  return false;
};

