import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { createMcpServer } from './createMcpServer';

interface RateLimitState {
  count: number;
  windowStart: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

const rateLimitStore = new Map<string, RateLimitState>();

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const mcpServer = await createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
    allowedHosts: config.http.allowedHosts.length ? config.http.allowedHosts : undefined,
    allowedOrigins: config.http.allowedOrigins.length ? config.http.allowedOrigins : undefined,
  });

  await mcpServer.connect(transport);

  app.addHook('onRequest', async (request, reply) => {
    const startTime = process.hrtime.bigint();
    request.headers['cache-control'] = request.headers['cache-control'] ?? 'no-store';

    request.log.debug(
      {
        method: request.method,
        url: request.url,
        ip: getClientIp(request),
      },
      'Incoming MCP HTTP request',
    );

    reply.raw.once('finish', () => {
      logResponse(request, reply, startTime, false);
    });

    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) {
        logResponse(request, reply, startTime, true);
      }
    });
  });

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp = getClientIp(request);
    const originResult = validateOrigin(request);

    if (!originResult.allowed) {
      request.log.warn(
        { ip: clientIp, origin: originResult.origin ?? null },
        'Rejected request due to disallowed origin',
      );
      return sendJsonError(
        reply,
        403,
        'Origin is not allowed for this endpoint.',
        { code: 'ORIGIN_NOT_ALLOWED' },
      );
    }

    const apiKeyResult = validateApiKey(request);
    if (!apiKeyResult.allowed) {
      request.log.warn(
        { ip: clientIp, reason: apiKeyResult.reason },
        'Rejected request due to invalid API key',
      );
      return sendJsonError(
        reply,
        401,
        'Invalid or missing API key.',
        { code: 'INVALID_API_KEY' },
        { 'www-authenticate': 'API-Key realm="mcp-prompts"' },
      );
    }

    if (apiKeyResult.validated) {
      request.log.debug({ ip: clientIp }, 'API key validated');
    }

    const rateResult = applyRateLimit(clientIp);

    if (!rateResult.allowed) {
      return sendJsonError(
        reply,
        429,
        'Too many requests. Please slow down.',
        {
          code: 'RATE_LIMITED',
          retryAfterSeconds: Math.ceil(rateResult.retryAfterMs / 1000),
        },
        {
          'retry-after': Math.ceil(rateResult.retryAfterMs / 1000).toString(),
        },
      );
    }

    if (request.method !== 'GET') {
      applyRequestTimeout(request, reply);
    }

    ensureAcceptHeader(request);

    reply.hijack();

    try {
      await transport.handleRequest(request.raw, reply.raw, request.body as unknown);
    } catch (error) {
      request.log.error(
        { err: error, method: request.method, url: request.url },
        'Failed to handle MCP HTTP request',
      );

      if (!reply.raw.headersSent) {
        const message =
          error instanceof Error ? error.message : 'Unexpected error handling MCP request';
        sendRawJsonError(reply, 500, message, 'INTERNAL_SERVER_ERROR');
      } else {
        reply.raw.destroy(error instanceof Error ? error : undefined);
      }
    }
  };

  app.options('/mcp', handler);
  app.get('/mcp', handler);
  app.post('/mcp', handler);
  app.delete('/mcp', handler);
}

function ensureAcceptHeader(request: FastifyRequest): void {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const acceptHeader = headers['accept'];

  if (Array.isArray(acceptHeader)) {
    if (!acceptHeader.some((value) => value.includes('text/event-stream'))) {
      acceptHeader.push('text/event-stream');
    }
    if (!acceptHeader.some((value) => value.includes('application/json'))) {
      acceptHeader.push('application/json');
    }
    return;
  }

  let newAccept = acceptHeader ?? '';
  if (!newAccept.includes('application/json')) {
    newAccept = newAccept ? `${newAccept}, application/json` : 'application/json';
  }
  if (!newAccept.includes('text/event-stream')) {
    newAccept = newAccept ? `${newAccept}, text/event-stream` : 'text/event-stream';
  }

  headers['accept'] = newAccept;
}

function sendJsonError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  details?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }
  }

  return reply.status(statusCode).send({
    error: {
      message,
      ...details,
    },
  });
}

function sendRawJsonError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code: string,
): void {
  reply.raw.writeHead(statusCode, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  reply.raw.end(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
  );
}

function getClientIp(request: FastifyRequest): string {
  const cfConnectingIp = request.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string') {
    return cfConnectingIp;
  }

  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.ip;
}

function logResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  startTime: bigint,
  aborted: boolean,
): void {
  const durationMs = Number((process.hrtime.bigint() - startTime) / BigInt(1_000_000));

  const statusCode = reply.raw.statusCode;
  if (aborted) {
    request.log.warn(
      {
        method: request.method,
        url: request.url,
        statusCode,
        durationMs,
        ip: getClientIp(request),
      },
      'MCP HTTP request aborted by client',
    );
    return;
  }

  request.log.info(
    {
      method: request.method,
      url: request.url,
      statusCode,
      durationMs,
      ip: getClientIp(request),
    },
    'MCP HTTP request completed',
  );
}

function validateOrigin(request: FastifyRequest): { allowed: boolean; origin?: string } {
  const allowedOrigins = config.http.allowedOrigins;
  if (allowedOrigins.length === 0) {
    return { allowed: true };
  }

  const originHeader = typeof request.headers.origin === 'string' ? request.headers.origin : null;
  if (!originHeader) {
    return { allowed: true };
  }

  if (allowedOrigins.includes(originHeader)) {
    return { allowed: true, origin: originHeader };
  }

  return { allowed: false, origin: originHeader };
}

function validateApiKey(
  request: FastifyRequest,
): { allowed: boolean; reason?: string; validated?: boolean } {
  const expected = config.mcpApiKey;
  if (!expected) {
    return { allowed: true };
  }

  const header = request.headers['x-api-key'];
  const provided =
    typeof header === 'string' ? header.trim() : Array.isArray(header) ? header[0]?.trim() : null;

  if (!provided) {
    return { allowed: false, reason: 'missing' };
  }

  return timingSafeEqualBuffer(expected, provided)
    ? { allowed: true, validated: true }
    : { allowed: false, reason: 'mismatch' };
}

function timingSafeEqualBuffer(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function applyRateLimit(ip: string): RateLimitResult {
  const limit = config.http.rateLimitMax;
  const windowMs = config.http.rateLimitWindowMs;
  const now = Date.now();

  const state = rateLimitStore.get(ip);
  if (!state || now - state.windowStart >= windowMs) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: windowMs };
  }

  if (state.count >= limit) {
    const retryAfter = windowMs - (now - state.windowStart);
    return { allowed: false, retryAfterMs: retryAfter };
  }

  state.count += 1;
  return { allowed: true, retryAfterMs: windowMs - (now - state.windowStart) };
}

function applyRequestTimeout(request: FastifyRequest, reply: FastifyReply): void {
  const timeoutMs = config.http.requestTimeoutMs;
  if (timeoutMs <= 0) {
    return;
  }

  request.raw.setTimeout(timeoutMs, () => {
    if (reply.raw.writableEnded || reply.raw.headersSent) {
      return;
    }

    sendRawJsonError(reply, 408, 'Request timed out.', 'REQUEST_TIMEOUT');
    request.raw.destroy();
  });
}
