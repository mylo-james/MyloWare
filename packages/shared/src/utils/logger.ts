import winston from 'winston';
import { LogLevel, Environment } from '../types/common';

/**
 * Create a Winston logger instance with standardized configuration
 */
export function createLogger(service: string, logLevel: LogLevel = 'INFO'): winston.Logger {
  const environment = (process.env['NODE_ENV'] as Environment) || 'development';

  const logger = winston.createLogger({
    level: logLevel.toLowerCase(),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, service: svc, ...meta }) => {
        return JSON.stringify({
          timestamp,
          level,
          service: svc || service,
          message,
          ...meta,
        });
      })
    ),
    defaultMeta: { service },
    transports: [
      new winston.transports.Console({
        format:
          environment === 'development'
            ? winston.format.combine(winston.format.colorize(), winston.format.simple())
            : winston.format.json(),
      }),
    ],
  });

  return logger;
}
