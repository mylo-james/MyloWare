import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).catch('development'),
  SERVER_HOST: z.string().default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().int().positive().default(3456),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HTTP_ALLOWED_ORIGINS: z.string().optional(),
  HTTP_ALLOWED_HOSTS: z.string().optional(),
  MCP_API_KEY: z.string().optional(),
});

type Environment = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formatted = parsedEnv.error.errors
    .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${formatted}`);
}

const data: Environment = parsedEnv.data;

function parseCsv(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export const config = {
  ...data,
  isProduction: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  isDevelopment: data.NODE_ENV === 'development',
  http: {
    rateLimitMax: data.HTTP_RATE_LIMIT_MAX,
    rateLimitWindowMs: data.HTTP_RATE_LIMIT_WINDOW_MS,
    requestTimeoutMs: data.HTTP_REQUEST_TIMEOUT_MS,
    allowedOrigins: parseCsv(data.HTTP_ALLOWED_ORIGINS),
    allowedHosts: parseCsv(data.HTTP_ALLOWED_HOSTS),
  },
  mcpApiKey: (() => {
    const value = data.MCP_API_KEY?.trim();
    return value && value.length > 0 ? value : null;
  })(),
} as const;
