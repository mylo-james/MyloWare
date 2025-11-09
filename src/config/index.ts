import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

function normalizeDatabaseUrl(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }

  // If we're running outside Docker, rewrite the hostname so macOS can reach Postgres
  const runningInDocker = process.env.DOCKER_CONTAINER === 'true';
  try {
    const parsed = new URL(url);
    if (!runningInDocker) {
      if (parsed.hostname === 'postgres') {
        parsed.hostname = 'localhost';
      }
      if (process.env.POSTGRES_PORT) {
        parsed.port = process.env.POSTGRES_PORT;
      }
      return parsed.toString();
    }
  } catch {
    // If URL parsing fails, fall back to the raw string
    return url;
  }

  return url;
}

const DEFAULT_ALLOWED_HOST_KEYS = ['127.0.0.1', 'localhost', 'mcp-server'] as const;

const ConfigSchema = z.object({
  database: z.object({
    url: z.string().url(),
  }),
  openai: z.object({
    apiKey: z.string().startsWith('sk-'),
  }),
  mcp: z.object({
    authKey: z.string().min(1),
  }),
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }),
  telegram: z
    .object({
      botToken: z.string().min(1),
      userId: z.string().optional(),
    })
    .optional(),
  n8n: z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    webhookAuthToken: z.string().optional(),
    webhookHeaderName: z.string().default('x-api-key'),
  }),
  session: z.object({
    ttlMs: z.number().default(3_600_000), // 1 hour
    maxSessionsPerUser: z.number().default(10),
  }),
  security: z.object({
    allowedCorsOrigins: z.array(z.string()).default([]),
    allowedHostKeys: z.array(z.string()).default([...DEFAULT_ALLOWED_HOST_KEYS]),
    debugAuth: z.boolean().default(false),
    rateLimitMax: z.number().default(100),
    rateLimitTimeWindow: z.string().default('1 minute'),
  }),
  web: z
    .object({
      userAgent: z.string().default('MyloWareBot/1.0'),
      timeoutMs: z.number().default(10000),
    })
    .optional(),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

type LogLevel = z.infer<typeof ConfigSchema>['logLevel'];

const rawDatabaseUrl =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === 'test'
    ? 'postgresql://test:test@127.0.0.1:6543/mcp_v2_test'
    : undefined);

export const config = ConfigSchema.parse({
  database: {
    url: normalizeDatabaseUrl(rawDatabaseUrl),
  },
  openai: {
    apiKey:
      process.env.OPENAI_API_KEY ??
      (process.env.NODE_ENV === 'test' ? 'sk-test' : undefined),
  },
  mcp: {
    authKey: (() => {
      // In test environment, use default test key
      if (process.env.NODE_ENV === 'test') {
        return process.env.MCP_AUTH_KEY || '00000000-0000-0000-0000-000000000000';
      }
      // In production, require auth key
      if (process.env.NODE_ENV === 'production') {
        if (!process.env.MCP_AUTH_KEY) {
          throw new Error('MCP_AUTH_KEY is required in production environment');
        }
        return process.env.MCP_AUTH_KEY;
      }
      // In development, allow optional but warn if missing
      if (!process.env.MCP_AUTH_KEY) {
        console.warn('⚠️  MCP_AUTH_KEY not set. Authentication is disabled. Set MCP_AUTH_KEY in production.');
      }
      return process.env.MCP_AUTH_KEY || '';
    })(),
  },
  server: {
    port: parseInt(process.env.SERVER_PORT || '3000'),
    host: process.env.SERVER_HOST || '0.0.0.0',
  },
  telegram: process.env.TELEGRAM_BOT_TOKEN
    ? {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        userId: process.env.TELEGRAM_USER_ID,
      }
    : process.env.NODE_ENV === 'test'
      ? { botToken: 'test-telegram-token' }
      : undefined,
  n8n: {
    baseUrl: process.env.N8N_BASE_URL || 'http://n8n:5678',
    apiKey: process.env.N8N_API_KEY,
    webhookUrl: process.env.N8N_WEBHOOK_URL || process.env.N8N_BASE_URL || 'http://n8n:5678',
    webhookAuthToken: process.env.N8N_WEBHOOK_AUTH_TOKEN,
    webhookHeaderName: process.env.N8N_WEBHOOK_HEADER_NAME || 'x-api-key',
  },
  session: {
    ttlMs: parseInt(process.env.SESSION_TTL_MS || '3600000'),
    maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '10'),
  },
  security: {
    allowedCorsOrigins: process.env.ALLOWED_CORS_ORIGINS
      ? process.env.ALLOWED_CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0)
      : [],
    allowedHostKeys: process.env.ALLOWED_HOST_KEYS
      ? process.env.ALLOWED_HOST_KEYS.split(',')
          .map((host) => host.trim())
          .filter((host) => host.length > 0)
      : [...DEFAULT_ALLOWED_HOST_KEYS],
    debugAuth: (process.env.DEBUG_AUTH || '').toLowerCase() === 'true',
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW || '1 minute',
  },
  web: {
    userAgent: process.env.WEB_FETCH_USER_AGENT || 'MyloWareBot/1.0',
    timeoutMs: parseInt(process.env.WEB_FETCH_TIMEOUT_MS || '10000'),
  },
  logLevel: (process.env.LOG_LEVEL as LogLevel | undefined) || 'info',
});
