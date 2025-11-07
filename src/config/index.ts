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
  security: z
    .object({
      allowedOrigins: z.array(z.string()).default(['http://localhost:5678', 'http://n8n:5678']),
      rateLimitMax: z.number().default(100),
      rateLimitTimeWindow: z.string().default('1 minute'),
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
  security: {
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['*'],
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    rateLimitTimeWindow: process.env.RATE_LIMIT_TIME_WINDOW || '1 minute',
  },
  logLevel: (process.env.LOG_LEVEL as LogLevel | undefined) || 'info',
});
