import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  database: z.object({
    url: z.string().url(),
  }),
  openai: z.object({
    apiKey: z.string().startsWith('sk-'),
  }),
  mcp: z.object({
    authKey: z.string().uuid(),
  }),
  server: z.object({
    port: z.number().default(3000),
    host: z.string().default('0.0.0.0'),
  }),
  telegram: z.object({
    botToken: z.string().min(1),
    userId: z.string().optional(),
  }),
  n8n: z.object({
    webhookUrl: z.string().url().optional(),
  }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const config = ConfigSchema.parse({
  database: {
    url:
      process.env.DATABASE_URL ||
      (process.env.NODE_ENV === 'test'
        ? 'postgresql://test:test@127.0.0.1:6543/mcp_v2_test'
        : undefined),
  },
  openai: {
    apiKey:
      process.env.OPENAI_API_KEY ??
      (process.env.NODE_ENV === 'test' ? 'sk-test' : undefined),
  },
  mcp: {
    authKey:
      process.env.MCP_AUTH_KEY ||
      (process.env.NODE_ENV === 'test'
        ? '00000000-0000-0000-0000-000000000000'
        : undefined),
  },
  server: {
    port: parseInt(process.env.SERVER_PORT || '3000'),
    host: process.env.SERVER_HOST || '0.0.0.0',
  },
  telegram: {
    botToken:
      process.env.TELEGRAM_BOT_TOKEN ||
      (process.env.NODE_ENV === 'test' ? 'test-telegram-token' : ''),
    userId: process.env.TELEGRAM_USER_ID,
  },
  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || process.env.N8N_BASE_URL,
  },
  logLevel: (process.env.LOG_LEVEL as any) || 'info',
});
