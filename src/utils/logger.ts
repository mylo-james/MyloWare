import pino from 'pino';
import { config } from '../config/index.js';

// Use pretty printing only when running locally (not in Docker)
// In Docker, use structured JSON logs which are better for log aggregation
const usePrettyLogs = process.env.NODE_ENV === 'development' && !process.env.DOCKER_CONTAINER;

export const logger = pino({
  level: config.logLevel || 'info',
  transport: usePrettyLogs
    ? {
        target: 'pino-pretty',
        options: { colorize: true },
      }
    : undefined,
});

export function sanitizeParams(params: unknown): unknown {
  if (typeof params !== 'object' || params === null) {
    return params;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    // Hide sensitive fields
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('key')) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

